import { describe, expect, it } from 'vitest';
import { actorLabel, describeAuditEntry, memberNamesFromRows, NO_MEMBER_NAMES } from './audit-log';

const MEMBER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MECH_USER = '11111111-2222-3333-4444-555555555555';
const OWNER_USER = '01234567-89ab-cdef-0123-456789abcdef';
const names = memberNamesFromRows([
  { memberId: MEMBER_ID, userId: MECH_USER, displayName: 'Jonas Weber' },
  { memberId: '99999999-8888-7777-6666-555555555555', userId: '22222222-3333-4444-5555-666666666666', displayName: null },
]);

describe('actorLabel ("Durch" column, seen as "Mitarbeiter" in the browser)', () => {
  it('names the employee who acted instead of a generic "Mitarbeiter"', () => {
    expect(actorLabel(MECH_USER, OWNER_USER, names)).toBe('Jonas Weber');
  });
  it('uses the staff page fallback for members without a name', () => {
    expect(actorLabel('22222222-3333-4444-5555-666666666666', OWNER_USER, names)).toBe('Mitarbeiter 99999999');
  });
  it('keeps "Du", "System" and the fallback when names are unknown', () => {
    expect(actorLabel(OWNER_USER, OWNER_USER, names)).toBe('Du');
    expect(actorLabel(null, OWNER_USER, names)).toBe('System');
    expect(actorLabel(MECH_USER, OWNER_USER, NO_MEMBER_NAMES)).toBe('Mitarbeiter');
    expect(actorLabel(MECH_USER, OWNER_USER)).toBe('Mitarbeiter');
  });
});

describe('describeAuditEntry for staff changes (was raw "tenant_members.update")', () => {
  it('describes adding a member with name and role', () => {
    expect(
      describeAuditEntry({
        action: 'tenant_members.insert',
        entityId: MEMBER_ID,
        data: { after: { id: MEMBER_ID, display_name: 'Jonas Weber', role: 'mechanic' } },
      }),
    ).toEqual({ title: 'Mitarbeiter Jonas Weber hinzugefügt', detail: 'Rolle: Mechaniker' });
  });

  it('describes deactivation and reactivation by the member name', () => {
    expect(describeAuditEntry({ action: 'tenant_members.update', entityId: MEMBER_ID, data: changed({ deactivated_at: [null, '2026-11-18T15:30:00Z'] }) }, names)).toEqual({
      title: 'Jonas Weber deaktiviert',
      detail: 'Der Zugang wurde gesperrt.',
    });
    expect(describeAuditEntry({ action: 'tenant_members.update', entityId: MEMBER_ID, data: changed({ deactivated_at: ['2026-11-18T15:30:00Z', null] }) }, names).title).toBe(
      'Jonas Weber wieder aktiviert',
    );
  });

  it('describes a role change with German role names', () => {
    expect(describeAuditEntry({ action: 'tenant_members.update', entityId: MEMBER_ID, data: changed({ role: ['mechanic', 'office'] }) }, names)).toEqual({
      title: 'Rolle von Jonas Weber geändert',
      detail: 'Mechaniker → Büro',
    });
  });

  it('describes a name change and removal', () => {
    expect(describeAuditEntry({ action: 'tenant_members.update', entityId: MEMBER_ID, data: changed({ display_name: ['Alt', 'Neu'] }) }, names).detail).toBe('Alt → Neu');
    expect(
      describeAuditEntry({ action: 'tenant_members.delete', entityId: MEMBER_ID, data: { before: { id: MEMBER_ID, display_name: null, role: 'office' } } }).title,
    ).toBe('Mitarbeiter aaaaaaaa entfernt');
    expect(
      describeAuditEntry({ action: 'tenant_members.delete', data: { before: { id: MEMBER_ID, display_name: 'Anna Weber' } } }).title,
    ).toBe('Mitarbeiter Anna Weber entfernt');
  });

  it('still reads well without names (migration 0021 missing) and with broken data', () => {
    expect(describeAuditEntry({ action: 'tenant_members.update', entityId: MEMBER_ID, data: changed({ role: ['x', 'owner'] }) }).title).toBe('Rolle von Mitarbeiter geändert');
    expect(describeAuditEntry({ action: 'tenant_members.update', entityId: MEMBER_ID, data: changed({ role: ['x', 'owner'] }) }).detail).toBe('– → Inhaber');
    expect(describeAuditEntry({ action: 'tenant_members.update', data: null }).title).toBe('Mitarbeiter geändert');
    expect(describeAuditEntry({ action: 'tenant_members.insert', data: 'kaputt' }).title).toMatch(/^Mitarbeiter.* hinzugefügt$/);
  });
});

const changed = (fields: Record<string, [unknown, unknown]>) => ({
  changed: Object.fromEntries(Object.entries(fields).map(([key, [oldValue, newValue]]) => [key, { old: oldValue, new: newValue }])),
});

describe('describeAuditEntry', () => {
  it('names the issued invoice by its number', () => {
    const entry = {
      action: 'invoices.update',
      data: changed({ status: ['draft', 'issued'], number: [null, 'RE-2026-0001'], issued_at: [null, '2026-11-17T10:00:00Z'] }),
    };
    expect(describeAuditEntry(entry)).toEqual({ title: 'Rechnung RE-2026-0001 ausgestellt', detail: null });
  });

  it('describes a cancellation and the Storno draft', () => {
    expect(describeAuditEntry({ action: 'invoices.update', data: changed({ status: ['issued', 'cancelled'] }) }).title).toBe(
      'Rechnung storniert',
    );
    expect(describeAuditEntry({ action: 'invoices.insert', data: { after: { cancels_invoice_id: 'abc' } } }).title).toBe(
      'Stornorechnung angelegt (Entwurf)',
    );
    expect(describeAuditEntry({ action: 'invoices.insert', data: { after: { cancels_invoice_id: null } } }).title).toBe(
      'Rechnungsentwurf angelegt',
    );
  });

  it('lists which fields of a draft changed, in German', () => {
    const result = describeAuditEntry({ action: 'invoices.update', data: changed({ due_date: ['a', 'b'], customer_id: ['x', 'y'] }) });
    expect(result.title).toBe('Rechnungsentwurf geändert');
    expect(result.detail).toBe('Geändert: Fälligkeit, Kunde');
  });

  it('shows payment amounts in euro', () => {
    const result = describeAuditEntry({ action: 'payments.insert', data: { after: { amount_cents: 12_345 } } });
    expect(result.title.replace(/\s/g, ' ')).toBe('Zahlung erfasst: 123,45 €');
    expect(describeAuditEntry({ action: 'payments.insert', data: {} }).title).toBe('Zahlung erfasst');
  });

  it('shows the status path of a work order', () => {
    const result = describeAuditEntry({ action: 'work_orders.update', data: changed({ status: ['approved', 'in_progress'] }) });
    expect(result).toEqual({ title: 'Auftragsstatus geändert', detail: 'Freigegeben → In Arbeit' });
    expect(describeAuditEntry({ action: 'work_orders.insert', data: { after: { number: 'A-2026-0007' } } }).title).toBe(
      'Auftrag A-2026-0007 angelegt',
    );
  });

  it('describes stock movements with sign, quantity and reason', () => {
    expect(describeAuditEntry({ action: 'stock_movements.insert', data: { after: { qty_milli: 5_000, reason: 'purchase' } } })).toEqual({
      title: 'Lagerbewegung',
      detail: '+5 · Wareneingang',
    });
    expect(describeAuditEntry({ action: 'stock_movements.insert', data: { after: { qty_milli: -2_500, reason: 'work_order' } } }).detail).toBe(
      '-2,5 · Verbrauch im Auftrag',
    );
  });

  it('falls back to the raw action and survives broken data', () => {
    expect(describeAuditEntry({ action: 'something.new', data: null })).toEqual({ title: 'something.new', detail: null });
    expect(describeAuditEntry({ action: 'invoices.update', data: 'not json' }).title).toBe('Rechnungsentwurf geändert');
    expect(describeAuditEntry({ action: 'payments.insert', data: { after: { amount_cents: 'x' } } }).title).toBe('Zahlung erfasst');
  });
});
