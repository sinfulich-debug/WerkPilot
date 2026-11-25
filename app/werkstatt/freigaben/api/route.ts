import { NextResponse } from 'next/server';
import {
  ApprovalNotAllowedError,
  ApprovalOrderNotFoundError,
  createApprovalLink,
  listApprovals,
  revokeApprovalLink,
} from '../../../../lib/db/estimate-approvals';
import { isUuid } from '../../../../lib/inspections';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';

// Approval links for estimates, staff side. Every member of the workshop may make, see and withdraw
// links (the same as setting the status of an estimate by hand). The secret token is returned once,
// when the link is created; it is never stored and cannot be read again.

const ACTIONS = ['create', 'revoke'] as const;

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function errorResponse(error: unknown) {
  if (error instanceof NoTenantError) return fail(401, 'Keiner Werkstatt zugeordnet.');
  if (error instanceof ForbiddenError) return fail(403, 'Keine Berechtigung.');
  if (error instanceof ApprovalOrderNotFoundError) return fail(404, error.message);
  if (error instanceof ApprovalNotAllowedError) return fail(409, error.message);
  console.error('Freigabe-Links konnten nicht verarbeitet werden.', error);
  return fail(500, 'Freigabe-Links konnten nicht verarbeitet werden.');
}

export async function GET() {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    return NextResponse.json({ ok: true, approvals: await listApprovals(tenantId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  if (!action || !(ACTIONS as readonly string[]).includes(action)) return fail(400, 'Unbekannte Aktion.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Ungültige JSON-Anfrage.');
  }
  const value = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!value) return fail(400, 'Ungültige Anfrage.');

  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    if (action === 'create') {
      if (!isUuid(value.workOrderId)) return fail(400, 'Die Kennung des Auftrags ist ungültig.');
      const link = await createApprovalLink(tenantId, value.workOrderId);
      return NextResponse.json(
        { ok: true, id: link.id, token: link.token, expiresAt: link.expiresAt.toISOString() },
        { status: 201, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!isUuid(value.id)) return fail(400, 'Die Kennung des Links ist ungültig.');
    const revoked = await revokeApprovalLink(tenantId, value.id);
    if (!revoked) return fail(409, 'Dieser Link kann nicht mehr zurückgezogen werden (bereits beantwortet oder zurückgezogen).');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
