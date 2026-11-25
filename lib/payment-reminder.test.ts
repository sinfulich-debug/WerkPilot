import { describe, expect, it } from 'vitest';
import { buildReminderDraft, suggestReminderLevel, type ReminderInput } from './payment-reminder';

const input: ReminderInput = {
  level: 'reminder',
  sellerName: 'Kfz Meier',
  customerName: 'Anna Müller',
  invoiceNumber: 'RE-2026-0007',
  dueDate: '2026-11-01',
  grossCents: 9_520,
  openCents: 9_520,
  today: '2026-11-17',
};

describe('suggestReminderLevel', () => {
  it('steps up with the number of overdue days', () => {
    expect(suggestReminderLevel(1)).toBe('reminder');
    expect(suggestReminderLevel(14)).toBe('reminder');
    expect(suggestReminderLevel(15)).toBe('first');
    expect(suggestReminderLevel(28)).toBe('first');
    expect(suggestReminderLevel(29)).toBe('second');
  });
});

describe('buildReminderDraft', () => {
  it('writes a friendly reminder with number, amount, due date and a new deadline', () => {
    const { subject, body } = buildReminderDraft(input);
    expect(subject).toBe('Zahlungserinnerung zu Rechnung RE-2026-0007');
    expect(body).toContain('RE-2026-0007');
    expect(body).toContain('95,20 €');
    expect(body).toContain('fällig am 01.11.2026');
    expect(body).toContain('bis zum 24.11.2026'); // today + 7 days
    expect(body).toContain('gegenstandslos');
    expect(body.endsWith('Kfz Meier')).toBe(true);
  });

  it('mentions only the open rest of a part-paid invoice', () => {
    const { body } = buildReminderDraft({ ...input, openCents: 7_520 });
    expect(body).toContain('nur teilweise beglichen');
    expect(body).toContain('noch 75,20 € offen');
    expect(body).toContain('95,20 €');
  });

  it('gets firmer with each level but never invents fees or interest', () => {
    const first = buildReminderDraft({ ...input, level: 'first' });
    const second = buildReminderDraft({ ...input, level: 'second' });
    expect(first.subject).toBe('1. Mahnung zu Rechnung RE-2026-0007');
    expect(first.body).toContain('trotz unserer Zahlungserinnerung');
    expect(second.subject).toBe('2. Mahnung zu Rechnung RE-2026-0007');
    expect(second.body).toContain('weitere Schritte');
    for (const draft of [first, second]) {
      expect(draft.body).not.toMatch(/Mahngebühr|Verzugszins|Inkasso/i);
    }
  });

  it('uses a plain space in amounts so the text pastes cleanly into an e-mail', () => {
    expect(buildReminderDraft(input).body).not.toContain(' ');
  });

  it('supports another grace period and rejects nonsense', () => {
    expect(buildReminderDraft({ ...input, graceDays: 14 }).body).toContain('bis zum 01.12.2026');
    expect(() => buildReminderDraft({ ...input, openCents: 0 })).toThrow(RangeError);
    expect(() => buildReminderDraft({ ...input, graceDays: 0 })).toThrow(RangeError);
    expect(() => buildReminderDraft({ ...input, graceDays: 90 })).toThrow(RangeError);
  });
});
