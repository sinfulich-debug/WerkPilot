/**
 * Rules for "the customer approves an estimate by link". Pure helpers: no database, no network,
 * so they can be tested on their own and used by pages. The secret token only ever exists in the link;
 * the database stores its hash (see estimate-approval-token.ts, server only).
 */
import type { WorkOrderStatus } from './work-order-status';
import type { ParseResult } from './workshop-settings';

/** A link works for this many days. */
export const APPROVAL_TTL_DAYS = 14;
export const MIN_SIGNER_NAME_LENGTH = 2;
export const MAX_SIGNER_NAME_LENGTH = 120;
export const MAX_DECISION_NOTE_LENGTH = 500;

/** base64url of 32 bytes is always 43 characters from this alphabet. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type ApprovalDecision = 'approved' | 'declined';

/** Quick shape check, so obviously wrong strings never reach the database. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** The moment a link created at `now` stops working. */
export function computeApprovalExpiry(now: Date, days = APPROVAL_TTL_DAYS): Date {
  const expiry = new Date(now.getTime());
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return expiry;
}

/** The address the customer opens. */
export function buildApprovalUrl(origin: string, token: string): string {
  return new URL(`/freigabe/${token}`, origin).toString();
}

export type ApprovalLinkState = {
  expiresAt: Date;
  decision: ApprovalDecision | null;
  revokedAt: Date | null;
  workOrderStatus: WorkOrderStatus;
  /** Gross total (cents) the customer saw when the link was created. */
  snapshotTotalCents: number;
  /** Gross total (cents) of the work order now. */
  currentTotalCents: number;
};

export type ApprovalLinkVerdict = 'open' | 'already_decided' | 'revoked' | 'expired' | 'not_estimate' | 'changed';

/**
 * Can the customer still decide? The first matching reason wins, in this order: a decision that was
 * already made is shown as it is; then revoked, expired, wrong status, changed amount.
 */
export function evaluateApprovalLink(state: ApprovalLinkState, now: Date): ApprovalLinkVerdict {
  if (state.decision !== null) return 'already_decided';
  if (state.revokedAt !== null) return 'revoked';
  if (now.getTime() >= state.expiresAt.getTime()) return 'expired';
  if (state.workOrderStatus !== 'estimate') return 'not_estimate';
  if (state.snapshotTotalCents !== state.currentTotalCents) return 'changed';
  return 'open';
}

/** German text for the customer's page when the link cannot be used (or was used). */
export function approvalVerdictMessage(verdict: Exclude<ApprovalLinkVerdict, 'open'>, decision: ApprovalDecision | null): string {
  switch (verdict) {
    case 'already_decided':
      return decision === 'approved'
        ? 'Sie haben diesen Kostenvoranschlag bereits freigegeben. Vielen Dank!'
        : 'Sie haben diesen Kostenvoranschlag bereits abgelehnt.';
    case 'revoked':
      return 'Dieser Link wurde von der Werkstatt zurückgezogen. Bitte nehmen Sie Kontakt mit uns auf.';
    case 'expired':
      return 'Dieser Link ist abgelaufen. Bitte nehmen Sie Kontakt mit der Werkstatt auf, wir senden Ihnen gern einen neuen.';
    case 'not_estimate':
      return 'Dieser Kostenvoranschlag kann nicht mehr online beantwortet werden. Bitte nehmen Sie Kontakt mit der Werkstatt auf.';
    case 'changed':
      return 'Der Kostenvoranschlag wurde nach dem Versand geändert. Bitte fordern Sie bei der Werkstatt einen neuen Link an.';
  }
}

export type DecisionInput = {
  decision: ApprovalDecision;
  signerName: string;
  note: string;
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * What the customer sends. "Approve" needs a name (the signature) and the tick "I agree";
 * "decline" needs neither, but may carry a short reason.
 */
export function parseDecisionInput(body: unknown): ParseResult<DecisionInput> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'Ungültige Anfrage.' };
  }
  const input = body as Record<string, unknown>;
  const decision = input.decision;
  if (decision !== 'approved' && decision !== 'declined') {
    return { ok: false, message: 'Bitte wählen Sie „Freigeben“ oder „Ablehnen“.' };
  }

  const rawName = input.signerName ?? '';
  const rawNote = input.note ?? '';
  if (typeof rawName !== 'string' || typeof rawNote !== 'string') {
    return { ok: false, message: 'Ungültige Anfrage.' };
  }
  const signerName = cleanText(rawName);
  const note = cleanText(rawNote);
  if (CONTROL_CHARACTERS.test(rawName.replace(/\s/g, ' ')) || CONTROL_CHARACTERS.test(rawNote.replace(/\s/g, ' '))) {
    return { ok: false, message: 'Die Eingabe enthält ungültige Zeichen.' };
  }
  if (signerName.length > MAX_SIGNER_NAME_LENGTH) {
    return { ok: false, message: `Der Name darf höchstens ${MAX_SIGNER_NAME_LENGTH} Zeichen lang sein.` };
  }
  if (note.length > MAX_DECISION_NOTE_LENGTH) {
    return { ok: false, message: `Die Anmerkung darf höchstens ${MAX_DECISION_NOTE_LENGTH} Zeichen lang sein.` };
  }

  if (decision === 'approved') {
    if (input.consent !== true) {
      return { ok: false, message: 'Bitte bestätigen Sie, dass Sie dem Kostenvoranschlag zustimmen.' };
    }
    if (signerName.length < MIN_SIGNER_NAME_LENGTH) {
      return { ok: false, message: 'Bitte geben Sie zur Bestätigung Ihren Namen ein.' };
    }
  }
  return { ok: true, value: { decision, signerName, note } };
}

/** What the staff sees about a link (never the token: it is shown once, when the link is made). */
export type ApprovalSummary = {
  id: string;
  workOrderId: string;
  createdAt: string;
  expiresAt: string;
  decision: ApprovalDecision | null;
  decidedAt: string | null;
  signerName: string;
  decisionNote: string;
  revokedAt: string | null;
};

/** What the customer sees on the approval page: no purchase prices, no staff names, no contact data. */
export type ApprovalView = {
  workshopName: string;
  orderNumber: string;
  description: string;
  customerName: string;
  vehicle: string;
  plate: string;
  lines: Array<{
    description: string;
    kind: 'labor' | 'part';
    qtyMilli: number;
    unitPriceCents: number;
    taxRateBp: number;
    discountBp: number;
  }>;
  netCents: number;
  taxCents: number;
  grossCents: number;
  expiresAt: string;
};

/** The customer's page and its API are reached by link without an account. */
export function isApprovalPath(pathname: string): boolean {
  return pathname.startsWith('/freigabe/');
}

const berlinDateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const berlinDate = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' });

/**
 * Which link of a work order matters to the staff: an answered one first (the newest answer), then
 * a link that is still open, otherwise simply the newest one.
 */
export function pickRelevantApproval(list: readonly ApprovalSummary[], workOrderId: string, now: Date): ApprovalSummary | null {
  const own = list.filter((entry) => entry.workOrderId === workOrderId);
  const byNewest = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime();
  const answered = own
    .filter((entry) => entry.decision !== null)
    .sort((a, b) => byNewest(a.decidedAt ?? a.createdAt, b.decidedAt ?? b.createdAt));
  if (answered[0]) return answered[0];
  const open = own
    .filter((entry) => entry.revokedAt === null && new Date(entry.expiresAt).getTime() > now.getTime())
    .sort((a, b) => byNewest(a.createdAt, b.createdAt));
  if (open[0]) return open[0];
  return [...own].sort((a, b) => byNewest(a.createdAt, b.createdAt))[0] ?? null;
}

export type ApprovalBadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/** One line for the staff: what happened with the link of this work order. */
export function describeApprovalForStaff(
  approval: ApprovalSummary,
  orderStatus: WorkOrderStatus,
  now: Date,
): { tone: ApprovalBadgeTone; label: string } {
  const decidedAt = approval.decidedAt ? berlinDateTime.format(new Date(approval.decidedAt)) : '';
  if (approval.decision === 'approved') {
    const waiting = orderStatus === 'draft' || orderStatus === 'estimate';
    return waiting
      ? { tone: 'warning', label: `Kunde hat am ${decidedAt} zugestimmt (${approval.signerName}). Bitte Material prüfen und den Auftrag selbst freigeben.` }
      : { tone: 'success', label: `Vom Kunden freigegeben am ${decidedAt} (${approval.signerName}).` };
  }
  if (approval.decision === 'declined') {
    return { tone: 'danger', label: `Vom Kunden abgelehnt am ${decidedAt}${approval.decisionNote ? `: ${approval.decisionNote}` : '.'}` };
  }
  if (approval.revokedAt) return { tone: 'neutral', label: 'Freigabe-Link zurückgezogen.' };
  const expires = new Date(approval.expiresAt);
  if (now.getTime() >= expires.getTime()) return { tone: 'neutral', label: `Freigabe-Link abgelaufen am ${berlinDate.format(expires)}.` };
  return { tone: 'info', label: `Freigabe-Link erstellt, wartet auf Antwort (gültig bis ${berlinDate.format(expires)}).` };
}

/** The text the staff sends to the customer together with the link. */
export function buildApprovalShareMessage(input: { customerName: string; workshopName: string; url: string }): string {
  const workshop = input.workshopName.trim() || 'Ihre Werkstatt';
  return `Guten Tag ${input.customerName}, hier ist Ihr Kostenvoranschlag von ${workshop}. Bitte prüfen und online freigeben: ${input.url} Viele Grüße, ${workshop}`;
}
