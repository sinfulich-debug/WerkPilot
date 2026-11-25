import { NextResponse } from 'next/server';
import {
  answerApprovalLink,
  loadApprovalPage,
  lookupApprovalLink,
  type ApprovalLink,
} from '../../../../lib/db/estimate-approvals';
import {
  approvalVerdictMessage,
  isWellFormedToken,
  parseDecisionInput,
} from '../../../../lib/estimate-approval';
import { hashApprovalToken } from '../../../../lib/estimate-approval-token';
import { hitRateLimit } from '../../../../lib/db/rate-limit';
import { APPROVAL_ANSWER_LIMIT, APPROVAL_VIEW_LIMIT, type RateLimitRule } from '../../../../lib/rate-limit';

// Customer side of the approval link: NO login. The token in the address is the only credential.
// An unknown, malformed or unusable token always gets the same plain 404 (nothing to learn from it).
// Answers are never cached, never indexed and the address is not passed on in the Referer header.

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

const NOT_FOUND = { ok: false, error: 'Dieser Link ist ungültig.' };

async function findLink(token: string): Promise<ApprovalLink | null> {
  if (!isWellFormedToken(token)) return null;
  return lookupApprovalLink(hashApprovalToken(token));
}

/**
 * 429 when this client asked too often. If the counter itself fails, the request goes through:
 * a broken limiter must not lock a customer out (the lookup below would fail anyway without a database).
 */
async function tooManyRequests(request: Request, rule: RateLimitRule): Promise<Response | null> {
  try {
    if (await hitRateLimit(request.headers, rule)) return null;
  } catch (error) {
    console.error('Das Anfragelimit konnte nicht geprüft werden.', error);
    return null;
  }
  return NextResponse.json(
    { ok: false, error: 'Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut.' },
    { status: 429, headers: { ...PRIVATE_HEADERS, 'Retry-After': String(rule.windowSeconds) } },
  );
}

type Context = { params: { token: string } };

/** What the customer sees: the estimate and whether it can still be answered. */
export async function GET(request: Request, { params }: Context) {
  const limited = await tooManyRequests(request, APPROVAL_VIEW_LIMIT);
  if (limited) return limited;
  try {
    const link = await findLink(params.token);
    if (!link) return json(NOT_FOUND, 404);
    const page = await loadApprovalPage(link);
    if (!page) return json(NOT_FOUND, 404);
    return json({
      ok: true,
      verdict: page.verdict,
      decision: page.decision,
      message: page.verdict === 'open' ? null : approvalVerdictMessage(page.verdict, page.decision),
      view: page.view,
    });
  } catch (error) {
    console.error('Die Freigabe-Seite konnte nicht geladen werden.', error);
    return json({ ok: false, error: 'Die Seite konnte nicht geladen werden. Bitte versuchen Sie es später erneut.' }, 500);
  }
}

/** The customer's answer: approve (with name and tick) or decline. */
export async function POST(request: Request, { params }: Context) {
  const limited = await tooManyRequests(request, APPROVAL_ANSWER_LIMIT);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Ungültige Anfrage.' }, 400);
  }
  const input = parseDecisionInput(body);
  if (!input.ok) return json({ ok: false, error: input.message }, 400);

  try {
    const link = await findLink(params.token);
    if (!link) return json(NOT_FOUND, 404);
    const result = await answerApprovalLink(link, input.value);
    if (!result) return json(NOT_FOUND, 404);
    if (result.kind === 'refused') {
      return json({ ok: false, verdict: result.verdict, error: approvalVerdictMessage(result.verdict, result.decision) }, 409);
    }
    // whether the work order could be approved right away (stock) is the workshop's business, not the customer's
    return json({ ok: true, decision: result.decision });
  } catch (error) {
    console.error('Die Antwort zur Freigabe konnte nicht gespeichert werden.', error);
    return json({ ok: false, error: 'Ihre Antwort konnte nicht gespeichert werden. Bitte versuchen Sie es später erneut.' }, 500);
  }
}
