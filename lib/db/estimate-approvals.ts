import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  customers,
  estimateApprovals,
  tenantProfiles,
  vehicles,
  workOrderLines,
  workOrders,
} from '../../db/schema';
import { withAnon } from '../../db/with-anon';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { withUser, type UserTransaction } from '../../db/with-user';
import type { SessionContext } from '../session';
import {
  computeApprovalExpiry,
  evaluateApprovalLink,
  type ApprovalDecision,
  type ApprovalLinkVerdict,
  type ApprovalSummary,
  type ApprovalView,
  type DecisionInput,
} from '../estimate-approval';
import { generateApprovalToken, hashApprovalToken } from '../estimate-approval-token';
import { workOrderTotals } from '../money';
import { StockUnavailableError } from '../stock';
import { PartNotFoundError } from './parts';
import { applyWorkOrderStatus } from './work-orders';

export class ApprovalOrderNotFoundError extends Error {
  constructor() {
    super('Der Auftrag wurde nicht gefunden.');
    this.name = 'ApprovalOrderNotFoundError';
  }
}

export class ApprovalNotAllowedError extends Error {
  constructor() {
    super('Ein Freigabe-Link kann nur für einen Kostenvoranschlag erstellt werden.');
    this.name = 'ApprovalNotAllowedError';
  }
}

/** What the anonymous lookup returns: enough to continue as the member who made the link. */
export type ApprovalLink = {
  id: string;
  tenantId: string;
  workOrderId: string;
  createdBy: string;
  expiresAt: Date;
  decision: ApprovalDecision | null;
  revokedAt: Date | null;
  totalGrossCents: number;
};

type ApprovalRow = typeof estimateApprovals.$inferSelect;

function toSummary(row: ApprovalRow): ApprovalSummary {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decision: row.decision as ApprovalDecision | null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    signerName: row.signerName,
    decisionNote: row.decisionNote,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Status and money of a work order, read inside the running transaction. */
async function loadOrderMoney(tx: UserTransaction, tenantId: string, workOrderId: string) {
  const [order] = await tx
    .select({ status: workOrders.status })
    .from(workOrders)
    .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, workOrderId)));
  if (!order) return null;
  const lines = await tx
    .select()
    .from(workOrderLines)
    .where(and(eq(workOrderLines.tenantId, tenantId), eq(workOrderLines.workOrderId, workOrderId)))
    .orderBy(asc(workOrderLines.position));
  const totals = workOrderTotals(lines.map((line) => ({
    kind: line.kind,
    qtyMilli: line.qtyMilli,
    unitPriceCents: line.unitPriceCents,
    taxRateBp: line.taxRateBp,
    discountBp: line.discountBp,
  })));
  return { status: order.status, lines, totals: totals.total };
}

// ---------------------------------------------------------------------------------------------
// Staff side: runs as the signed-in member (withTenant)
// ---------------------------------------------------------------------------------------------

/** Creates a link for an estimate in the name of the signed-in member. The token is returned only here. */
export async function createApprovalLinkInTx(
  tx: UserTransaction,
  context: SessionContext,
  tenantId: string,
  workOrderId: string,
  now = new Date(),
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const order = await loadOrderMoney(tx, tenantId, workOrderId);
  if (!order) throw new ApprovalOrderNotFoundError();
  if (order.status !== 'estimate') throw new ApprovalNotAllowedError();

  const token = generateApprovalToken();
  const expiresAt = computeApprovalExpiry(now);
  const [created] = await tx
    .insert(estimateApprovals)
    .values({
      tenantId,
      workOrderId,
      tokenHash: hashApprovalToken(token),
      createdBy: context.userId,
      createdAt: now,
      expiresAt,
      totalGrossCents: order.totals.grossCents,
    })
    .returning({ id: estimateApprovals.id });
  if (!created) throw new Error('Der Freigabe-Link konnte nicht erstellt werden.');
  return { id: created.id, token, expiresAt };
}

export async function createApprovalLink(tenantId: string, workOrderId: string) {
  return withTenant((tx, context) => {
    assertTenantContext(tenantId, context);
    return createApprovalLinkInTx(tx, context, tenantId, workOrderId);
  });
}

/** All links of the workshop, newest first (the page picks the latest one per work order). */
export async function listApprovalsInTx(tx: UserTransaction, tenantId: string): Promise<ApprovalSummary[]> {
  const rows = await tx
    .select()
    .from(estimateApprovals)
    .where(eq(estimateApprovals.tenantId, tenantId))
    .orderBy(desc(estimateApprovals.createdAt))
    .limit(500);
  return rows.map(toSummary);
}

export async function listApprovals(tenantId: string): Promise<ApprovalSummary[]> {
  return withTenant((tx, context) => {
    assertTenantContext(tenantId, context);
    return listApprovalsInTx(tx, tenantId);
  });
}

/** Withdraws a link that has not been answered yet. False when there is nothing to withdraw. */
export async function revokeApprovalLinkInTx(tx: UserTransaction, tenantId: string, id: string): Promise<boolean> {
  const revoked = await tx
    .update(estimateApprovals)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(estimateApprovals.tenantId, tenantId),
      eq(estimateApprovals.id, id),
      isNull(estimateApprovals.decision),
      isNull(estimateApprovals.revokedAt),
    ))
    .returning({ id: estimateApprovals.id });
  return revoked.length > 0;
}

export async function revokeApprovalLink(tenantId: string, id: string): Promise<boolean> {
  return withTenant((tx, context) => {
    assertTenantContext(tenantId, context);
    return revokeApprovalLinkInTx(tx, tenantId, id);
  });
}

// ---------------------------------------------------------------------------------------------
// Customer side: no login. The lookup runs as "anon"; everything else runs as the member who made
// the link (withUser), so row-level security still applies and the stock rules stay the same.
// ---------------------------------------------------------------------------------------------

export async function lookupApprovalLink(tokenHash: string): Promise<ApprovalLink | null> {
  return withAnon(async (tx) => {
    const rows = await tx.execute<{
      id: string;
      tenant_id: string;
      work_order_id: string;
      created_by: string;
      expires_at: Date | string;
      decision: string | null;
      revoked_at: Date | string | null;
      total_gross_cents: number;
    }>(sql`select * from public.lookup_estimate_approval(${tokenHash})`);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workOrderId: row.work_order_id,
      createdBy: row.created_by,
      expiresAt: new Date(row.expires_at),
      decision: row.decision as ApprovalDecision | null,
      revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
      totalGrossCents: row.total_gross_cents,
    };
  });
}

export type ApprovalPage = {
  verdict: ApprovalLinkVerdict;
  decision: ApprovalDecision | null;
  view: ApprovalView;
};

export async function loadApprovalPageInTx(
  tx: UserTransaction,
  link: ApprovalLink,
  now = new Date(),
): Promise<ApprovalPage | null> {
  const [approval] = await tx
    .select()
    .from(estimateApprovals)
    .where(and(eq(estimateApprovals.tenantId, link.tenantId), eq(estimateApprovals.id, link.id)));
  const money = await loadOrderMoney(tx, link.tenantId, link.workOrderId);
  if (!approval || !money) return null;

  const [details] = await tx
    .select({
      description: workOrders.description,
      number: workOrders.number,
      customerName: customers.name,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      plate: vehicles.plate,
    })
    .from(workOrders)
    .innerJoin(customers, and(eq(customers.tenantId, workOrders.tenantId), eq(customers.id, workOrders.customerId)))
    .innerJoin(vehicles, and(eq(vehicles.tenantId, workOrders.tenantId), eq(vehicles.id, workOrders.vehicleId)))
    .where(and(eq(workOrders.tenantId, link.tenantId), eq(workOrders.id, link.workOrderId)));
  if (!details) return null;
  const [profile] = await tx
    .select({ companyName: tenantProfiles.companyName })
    .from(tenantProfiles)
    .where(eq(tenantProfiles.tenantId, link.tenantId));

  const decision = approval.decision as ApprovalDecision | null;
  const verdict = evaluateApprovalLink({
    expiresAt: approval.expiresAt,
    decision,
    revokedAt: approval.revokedAt,
    workOrderStatus: money.status,
    snapshotTotalCents: approval.totalGrossCents,
    currentTotalCents: money.totals.grossCents,
  }, now);

  return {
    verdict,
    decision,
    view: {
      workshopName: profile?.companyName ?? '',
      orderNumber: details.number,
      description: details.description,
      customerName: details.customerName,
      vehicle: [details.vehicleMake, details.vehicleModel].filter(Boolean).join(' '),
      plate: details.plate,
      lines: money.lines.map((line) => ({
        description: line.description,
        kind: line.kind,
        qtyMilli: line.qtyMilli,
        unitPriceCents: line.unitPriceCents,
        taxRateBp: line.taxRateBp,
        discountBp: line.discountBp,
      })),
      netCents: money.totals.netCents,
      taxCents: money.totals.taxCents,
      grossCents: money.totals.grossCents,
      expiresAt: approval.expiresAt.toISOString(),
    },
  };
}

export async function loadApprovalPage(link: ApprovalLink): Promise<ApprovalPage | null> {
  return withUser(link.createdBy, link.tenantId, (tx) => loadApprovalPageInTx(tx, link));
}

export type AnswerResult =
  | { kind: 'refused'; verdict: Exclude<ApprovalLinkVerdict, 'open'>; decision: ApprovalDecision | null }
  | {
    kind: 'recorded';
    decision: ApprovalDecision;
    /** False when the customer agreed but the work order could not move to "approved" (for example no stock). */
    orderApproved: boolean;
  };

/**
 * Records the customer's answer. The answer is saved first and stays even when the work order cannot
 * be approved right away (missing parts): then the staff sees "customer agreed" and finishes by hand.
 */
export async function answerApprovalInTx(
  tx: UserTransaction,
  link: ApprovalLink,
  input: DecisionInput,
  now = new Date(),
): Promise<AnswerResult | null> {
  // lock the link, so two answers at the same moment cannot both win
  const [approval] = await tx
    .select()
    .from(estimateApprovals)
    .where(and(eq(estimateApprovals.tenantId, link.tenantId), eq(estimateApprovals.id, link.id)))
    .for('update');
  const money = await loadOrderMoney(tx, link.tenantId, link.workOrderId);
  if (!approval || !money) return null;

  const verdict = evaluateApprovalLink({
    expiresAt: approval.expiresAt,
    decision: approval.decision as ApprovalDecision | null,
    revokedAt: approval.revokedAt,
    workOrderStatus: money.status,
    snapshotTotalCents: approval.totalGrossCents,
    currentTotalCents: money.totals.grossCents,
  }, now);
  if (verdict !== 'open') {
    return { kind: 'refused', verdict, decision: approval.decision as ApprovalDecision | null };
  }

  await tx
    .update(estimateApprovals)
    .set({
      decision: input.decision,
      decidedAt: now,
      signerName: input.signerName,
      decisionNote: input.note,
    })
    .where(and(eq(estimateApprovals.tenantId, link.tenantId), eq(estimateApprovals.id, link.id)));

  let orderApproved = false;
  if (input.decision === 'approved') {
    try {
      // a savepoint: if the stock check fails only the status change is undone, not the answer
      await tx.transaction((inner) => applyWorkOrderStatus(inner, link.tenantId, link.workOrderId, 'approved'));
      orderApproved = true;
    } catch (error) {
      if (!(error instanceof StockUnavailableError) && !(error instanceof PartNotFoundError)) throw error;
    }
  }
  return { kind: 'recorded', decision: input.decision, orderApproved };
}

export async function answerApprovalLink(link: ApprovalLink, input: DecisionInput): Promise<AnswerResult | null> {
  return withUser(link.createdBy, link.tenantId, (tx) => answerApprovalInTx(tx, link, input));
}
