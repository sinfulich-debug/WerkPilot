import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TTL_DAYS,
  approvalVerdictMessage,
  buildApprovalShareMessage,
  buildApprovalUrl,
  computeApprovalExpiry,
  describeApprovalForStaff,
  isApprovalPath,
  pickRelevantApproval,
  type ApprovalSummary,
  evaluateApprovalLink,
  isWellFormedToken,
  MAX_DECISION_NOTE_LENGTH,
  MAX_SIGNER_NAME_LENGTH,
  parseDecisionInput,
  type ApprovalLinkState,
} from './estimate-approval';
import { generateApprovalToken } from './estimate-approval-token';

describe('isWellFormedToken', () => {
  it('accepts 43 url-safe characters', () => {
    expect(isWellFormedToken(generateApprovalToken())).toBe(true);
  });

  it('refuses strings that cannot be a token', () => {
    for (const bad of ['', 'abc', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}!`, `${'x'.repeat(42)}/`, null, undefined, 5]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});

describe('computeApprovalExpiry', () => {
  it('adds the default number of days and leaves the input untouched', () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    expect(computeApprovalExpiry(now).toISOString()).toBe('2026-12-02T10:00:00.000Z');
    expect(APPROVAL_TTL_DAYS).toBe(14);
    expect(now.toISOString()).toBe('2026-11-18T10:00:00.000Z');
  });

  it('crosses month and year borders and accepts another length', () => {
    expect(computeApprovalExpiry(new Date('2026-12-25T08:30:00.000Z')).toISOString()).toBe('2027-01-08T08:30:00.000Z');
    expect(computeApprovalExpiry(new Date('2026-11-18T10:00:00.000Z'), 1).toISOString()).toBe('2026-11-19T10:00:00.000Z');
  });
});

describe('buildApprovalUrl', () => {
  it('puts the token behind /freigabe/', () => {
    const token = generateApprovalToken();
    expect(buildApprovalUrl('https://app.werkpilot.de', token)).toBe(`https://app.werkpilot.de/freigabe/${token}`);
    expect(buildApprovalUrl('http://localhost:3000/', token)).toBe(`http://localhost:3000/freigabe/${token}`);
  });
});

describe('evaluateApprovalLink', () => {
  const now = new Date('2026-11-20T12:00:00.000Z');
  const open: ApprovalLinkState = {
    expiresAt: new Date('2026-12-02T12:00:00.000Z'),
    decision: null,
    revokedAt: null,
    workOrderStatus: 'estimate',
    snapshotTotalCents: 11_900,
    currentTotalCents: 11_900,
  };

  it('is open for a fresh link on an estimate', () => {
    expect(evaluateApprovalLink(open, now)).toBe('open');
  });

  it('names the reason when it is not open', () => {
    expect(evaluateApprovalLink({ ...open, decision: 'approved' }, now)).toBe('already_decided');
    expect(evaluateApprovalLink({ ...open, decision: 'declined' }, now)).toBe('already_decided');
    expect(evaluateApprovalLink({ ...open, revokedAt: new Date('2026-11-19T00:00:00.000Z') }, now)).toBe('revoked');
    expect(evaluateApprovalLink({ ...open, expiresAt: new Date('2026-11-19T00:00:00.000Z') }, now)).toBe('expired');
    expect(evaluateApprovalLink({ ...open, workOrderStatus: 'approved' }, now)).toBe('not_estimate');
    expect(evaluateApprovalLink({ ...open, workOrderStatus: 'draft' }, now)).toBe('not_estimate');
    expect(evaluateApprovalLink({ ...open, currentTotalCents: 12_000 }, now)).toBe('changed');
  });

  it('treats the exact expiry moment as expired, one millisecond before as open', () => {
    expect(evaluateApprovalLink({ ...open, expiresAt: now }, now)).toBe('expired');
    expect(evaluateApprovalLink({ ...open, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('open');
  });

  it('applies the reasons in a fixed order: decided, revoked, expired, status, amount', () => {
    const everythingWrong: ApprovalLinkState = {
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      decision: 'approved',
      revokedAt: new Date('2026-11-02T00:00:00.000Z'),
      workOrderStatus: 'invoiced',
      snapshotTotalCents: 1,
      currentTotalCents: 2,
    };
    expect(evaluateApprovalLink(everythingWrong, now)).toBe('already_decided');
    expect(evaluateApprovalLink({ ...everythingWrong, decision: null }, now)).toBe('revoked');
    expect(evaluateApprovalLink({ ...everythingWrong, decision: null, revokedAt: null }, now)).toBe('expired');
    expect(evaluateApprovalLink({ ...everythingWrong, decision: null, revokedAt: null, expiresAt: open.expiresAt }, now)).toBe('not_estimate');
  });
});

describe('approvalVerdictMessage', () => {
  it('has a German text for every reason and tells approved from declined', () => {
    expect(approvalVerdictMessage('already_decided', 'approved')).toContain('freigegeben');
    expect(approvalVerdictMessage('already_decided', 'declined')).toContain('abgelehnt');
    for (const verdict of ['revoked', 'expired', 'not_estimate', 'changed'] as const) {
      expect(approvalVerdictMessage(verdict, null).length).toBeGreaterThan(20);
    }
  });
});

describe('parseDecisionInput', () => {
  it('accepts an approval with name and consent, tidying the name', () => {
    expect(parseDecisionInput({ decision: 'approved', signerName: '  Anna   Müller ', consent: true })).toEqual({
      ok: true,
      value: { decision: 'approved', signerName: 'Anna Müller', note: '' },
    });
  });

  it('needs the consent tick and a name for an approval', () => {
    expect(parseDecisionInput({ decision: 'approved', signerName: 'Anna Müller' }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'approved', signerName: 'Anna Müller', consent: 'true' }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'approved', signerName: ' ', consent: true }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'approved', signerName: 'A', consent: true }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'approved', consent: true }).ok).toBe(false);
  });

  it('lets a decline go through without name and consent, with an optional reason', () => {
    expect(parseDecisionInput({ decision: 'declined' })).toEqual({
      ok: true,
      value: { decision: 'declined', signerName: '', note: '' },
    });
    expect(parseDecisionInput({ decision: 'declined', note: ' Zu teuer ' })).toEqual({
      ok: true,
      value: { decision: 'declined', signerName: '', note: 'Zu teuer' },
    });
  });

  it('refuses unknown decisions and wrong types', () => {
    for (const bad of [null, [], 'approved', 5, {}, { decision: 'maybe' }, { decision: 'approved', signerName: 5, consent: true }, { decision: 'declined', note: {} }]) {
      expect(parseDecisionInput(bad).ok).toBe(false);
    }
  });

  it('checks the lengths at the border', () => {
    const name = (length: number) => 'x'.repeat(length);
    expect(parseDecisionInput({ decision: 'approved', signerName: name(MAX_SIGNER_NAME_LENGTH), consent: true }).ok).toBe(true);
    expect(parseDecisionInput({ decision: 'approved', signerName: name(MAX_SIGNER_NAME_LENGTH + 1), consent: true }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'declined', note: name(MAX_DECISION_NOTE_LENGTH) }).ok).toBe(true);
    expect(parseDecisionInput({ decision: 'declined', note: name(MAX_DECISION_NOTE_LENGTH + 1) }).ok).toBe(false);
  });

  it('refuses hidden control characters but accepts normal line breaks in the note', () => {
    expect(parseDecisionInput({ decision: 'approved', signerName: 'Anna\u0000Müller', consent: true }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'declined', note: 'Zu teuer\u0007' }).ok).toBe(false);
    expect(parseDecisionInput({ decision: 'declined', note: 'Zu teuer\nbitte melden' })).toEqual({
      ok: true,
      value: { decision: 'declined', signerName: '', note: 'Zu teuer bitte melden' },
    });
  });
});

describe('isApprovalPath', () => {
  it('is true only below /freigabe/', () => {
    expect(isApprovalPath(`/freigabe/${'A'.repeat(43)}`)).toBe(true);
    expect(isApprovalPath(`/freigabe/${'A'.repeat(43)}/api`)).toBe(true);
    for (const path of ['/freigabe', '/freigaben/x', '/werkstatt/freigaben/api', '/', '/login', '/x/freigabe/y']) {
      expect(isApprovalPath(path)).toBe(false);
    }
  });
});

const summary = (over: Partial<ApprovalSummary>): ApprovalSummary => ({
  id: 'a1',
  workOrderId: 'o1',
  createdAt: '2026-11-18T10:00:00.000Z',
  expiresAt: '2026-12-02T10:00:00.000Z',
  decision: null,
  decidedAt: null,
  signerName: '',
  decisionNote: '',
  revokedAt: null,
  ...over,
});
const NOW = new Date('2026-11-20T12:00:00.000Z');

describe('pickRelevantApproval', () => {
  it('returns null when the order has no link', () => {
    expect(pickRelevantApproval([summary({ workOrderId: 'other' })], 'o1', NOW)).toBeNull();
    expect(pickRelevantApproval([], 'o1', NOW)).toBeNull();
  });

  it('prefers the newest answered link, then an open one, then the newest', () => {
    const oldOpen = summary({ id: 'open', createdAt: '2026-11-19T10:00:00.000Z' });
    const answered = summary({ id: 'answered', decision: 'declined', decidedAt: '2026-11-18T12:00:00.000Z' });
    const newerAnswer = summary({ id: 'answered2', decision: 'approved', decidedAt: '2026-11-19T12:00:00.000Z' });
    expect(pickRelevantApproval([oldOpen, answered], 'o1', NOW)?.id).toBe('answered');
    expect(pickRelevantApproval([oldOpen, answered, newerAnswer], 'o1', NOW)?.id).toBe('answered2');

    const revoked = summary({ id: 'revoked', revokedAt: '2026-11-19T10:00:00.000Z', createdAt: '2026-11-19T11:00:00.000Z' });
    const expired = summary({ id: 'expired', expiresAt: '2026-11-19T10:00:00.000Z' });
    expect(pickRelevantApproval([revoked, expired, oldOpen], 'o1', NOW)?.id).toBe('open');
    expect(pickRelevantApproval([expired, revoked], 'o1', NOW)?.id).toBe('revoked');
  });
});

describe('describeApprovalForStaff', () => {
  it('warns when the customer agreed but the order still waits (for example missing parts)', () => {
    const result = describeApprovalForStaff(
      summary({ decision: 'approved', decidedAt: '2026-11-19T09:30:00.000Z', signerName: 'Anna Müller' }),
      'estimate',
      NOW,
    );
    expect(result.tone).toBe('warning');
    expect(result.label).toContain('Anna Müller');
    expect(result.label).toContain('Material prüfen');
    expect(result.label).toContain('19.11.26');
  });

  it('shows success once the order moved on', () => {
    const result = describeApprovalForStaff(
      summary({ decision: 'approved', decidedAt: '2026-11-19T09:30:00.000Z', signerName: 'Anna Müller' }),
      'approved',
      NOW,
    );
    expect(result.tone).toBe('success');
    expect(result.label).toContain('freigegeben');
  });

  it('shows a decline with the reason', () => {
    const result = describeApprovalForStaff(
      summary({ decision: 'declined', decidedAt: '2026-11-19T09:30:00.000Z', decisionNote: 'Zu teuer' }),
      'estimate',
      NOW,
    );
    expect(result.tone).toBe('danger');
    expect(result.label).toContain('Zu teuer');
  });

  it('tells revoked, expired and open links apart', () => {
    expect(describeApprovalForStaff(summary({ revokedAt: '2026-11-19T10:00:00.000Z' }), 'estimate', NOW).tone).toBe('neutral');
    expect(describeApprovalForStaff(summary({ expiresAt: '2026-11-19T10:00:00.000Z' }), 'estimate', NOW).label).toContain('abgelaufen');
    expect(describeApprovalForStaff(summary({}), 'estimate', NOW).tone).toBe('info');
  });

  it('shows dates in Berlin time (late evening UTC is already the next day in Berlin)', () => {
    const result = describeApprovalForStaff(summary({ decision: 'declined', decidedAt: '2026-11-19T23:30:00.000Z' }), 'estimate', NOW);
    expect(result.label).toContain('20.11.26');
  });
});

describe('buildApprovalShareMessage', () => {
  it('names customer, workshop and the link', () => {
    const message = buildApprovalShareMessage({ customerName: 'Anna Müller', workshopName: 'Werkstatt GmbH', url: 'https://x.de/freigabe/abc' });
    expect(message).toContain('Anna Müller');
    expect(message).toContain('Werkstatt GmbH');
    expect(message).toContain('https://x.de/freigabe/abc');
  });

  it('falls back to a neutral workshop name', () => {
    expect(buildApprovalShareMessage({ customerName: 'A', workshopName: '  ', url: 'u' })).toContain('Ihre Werkstatt');
  });
});
