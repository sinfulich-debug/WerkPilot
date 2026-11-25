import { memberLabel, ROLE_LABELS } from './members';
import { formatEuro } from './money';
import type { Role } from './session';

/** Names of the workshop's members, for the change log. Keys: tenant_members.id and auth user id. */
export type MemberNames = {
  byMemberId: ReadonlyMap<string, string>;
  byUserId: ReadonlyMap<string, string>;
};

export const NO_MEMBER_NAMES: MemberNames = { byMemberId: new Map(), byUserId: new Map() };

/** Builds the lookup from the rows of get_tenant_member_names (members without a name get the same fallback as the staff page). */
export function memberNamesFromRows(
  rows: ReadonlyArray<{ memberId: string; userId: string; displayName: string | null }>,
): MemberNames {
  const byMemberId = new Map<string, string>();
  const byUserId = new Map<string, string>();
  for (const row of rows) {
    const label = memberLabel({ id: row.memberId, displayName: row.displayName });
    byMemberId.set(row.memberId, label);
    byUserId.set(row.userId, label);
  }
  return { byMemberId, byUserId };
}

/**
 * Who did it, for the "Durch" column. "Du" for yourself, the employee's name for everybody else,
 * "System" when no user was signed in (e.g. cleanup by the server). "Mitarbeiter" only when the name is unknown.
 */
export function actorLabel(userId: string | null, currentUserId: string, names: MemberNames = NO_MEMBER_NAMES): string {
  if (userId === null) return 'System';
  if (userId === currentUserId) return 'Du';
  return names.byUserId.get(userId) ?? 'Mitarbeiter';
}

/** "Mitarbeiter Anna Weber", or the staff page fallback "Mitarbeiter 1a2b3c4d" when there is no name. */
function staffName(row: Record<string, unknown>, entityId: string | undefined): string {
  const displayName = typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim() : null;
  if (displayName) return `Mitarbeiter ${displayName}`;
  const id = typeof row.id === 'string' ? row.id : (entityId ?? '');
  return memberLabel({ id, displayName: null });
}

function roleName(value: unknown): string | null {
  return typeof value === 'string' && value in ROLE_LABELS ? ROLE_LABELS[value as Role] : null;
}

/** One audit_log row as the application sees it. `data` is what the database trigger stored. */
export type AuditEntry = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string | null;
  data: unknown;
  createdAt: string;
};

export type AuditDescription = {
  /** Short German headline, e.g. "Rechnung RE-2026-0001 ausgestellt". */
  title: string;
  /** Extra detail for the second line, or null. */
  detail: string | null;
};

const WORK_ORDER_STATUS: Record<string, string> = {
  draft: 'Entwurf',
  estimate: 'Kostenvoranschlag',
  approved: 'Freigegeben',
  in_progress: 'In Arbeit',
  completed: 'Abgeschlossen',
  invoiced: 'Rechnung erstellt',
};

const STOCK_REASON: Record<string, string> = {
  purchase: 'Wareneingang',
  work_order: 'Verbrauch im Auftrag',
  correction: 'Korrektur',
};

const INVOICE_FIELD: Record<string, string> = {
  customer_id: 'Kunde',
  vehicle_id: 'Fahrzeug',
  service_date: 'Leistungsdatum',
  due_date: 'Fälligkeit',
  seller_snapshot: 'Verkäuferdaten',
  buyer_snapshot: 'Käuferdaten',
  work_order_id: 'Auftrag',
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(data: unknown, key: 'after' | 'before'): Json {
  return isRecord(data) && isRecord(data[key]) ? data[key] : {};
}

function changedFields(data: unknown): Record<string, { old: unknown; new: unknown }> {
  const changed = isRecord(data) ? data.changed : undefined;
  if (!isRecord(changed)) return {};
  const result: Record<string, { old: unknown; new: unknown }> = {};
  for (const [field, value] of Object.entries(changed)) {
    if (isRecord(value)) result[field] = { old: value.old, new: value.new };
  }
  return result;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function statusName(value: unknown): string {
  return WORK_ORDER_STATUS[text(value) ?? ''] ?? text(value) ?? '–';
}

/** Turns a raw audit entry into a headline a workshop owner understands. Unknown entries fall back to the raw action. */
export function describeAuditEntry(
  entry: Pick<AuditEntry, 'action' | 'data'> & Partial<Pick<AuditEntry, 'entityId'>>,
  names: MemberNames = NO_MEMBER_NAMES,
): AuditDescription {
  const { action, data } = entry;
  const after = section(data, 'after');
  const before = section(data, 'before');
  const changed = changedFields(data);

  switch (action) {
    case 'invoices.insert':
      return after.cancels_invoice_id
        ? { title: 'Stornorechnung angelegt (Entwurf)', detail: null }
        : { title: 'Rechnungsentwurf angelegt', detail: null };

    case 'invoices.update': {
      const status = changed.status;
      if (status?.new === 'issued') {
        const number = text(changed.number?.new);
        return { title: number ? `Rechnung ${number} ausgestellt` : 'Rechnung ausgestellt', detail: null };
      }
      if (status?.new === 'cancelled') {
        return { title: 'Rechnung storniert', detail: 'Es wurde eine Stornorechnung erstellt.' };
      }
      const fields = Object.keys(changed).map((field) => INVOICE_FIELD[field] ?? field);
      return {
        title: 'Rechnungsentwurf geändert',
        detail: fields.length > 0 ? `Geändert: ${fields.join(', ')}` : null,
      };
    }

    case 'invoices.delete':
      return { title: 'Rechnungsentwurf gelöscht', detail: null };

    case 'payments.insert': {
      const cents = integer(after.amount_cents);
      return {
        title: cents === null ? 'Zahlung erfasst' : `Zahlung erfasst: ${formatEuro(cents)}`,
        detail: null,
      };
    }
    case 'payments.update':
      return { title: 'Zahlung geändert', detail: null };
    case 'payments.delete': {
      const cents = integer(before.amount_cents);
      return { title: cents === null ? 'Zahlung gelöscht' : `Zahlung gelöscht: ${formatEuro(cents)}`, detail: null };
    }

    case 'work_orders.insert': {
      const number = text(after.number);
      return { title: number ? `Auftrag ${number} angelegt` : 'Auftrag angelegt', detail: null };
    }
    case 'work_orders.update': {
      const status = changed.status;
      if (status) {
        return {
          title: 'Auftragsstatus geändert',
          detail: `${statusName(status.old)} → ${statusName(status.new)}`,
        };
      }
      const fields = Object.keys(changed);
      return { title: 'Auftrag geändert', detail: fields.length > 0 ? `Geändert: ${fields.join(', ')}` : null };
    }
    case 'work_orders.delete': {
      const number = text(before.number);
      return { title: number ? `Auftrag ${number} gelöscht` : 'Auftrag gelöscht', detail: null };
    }

    case 'stock_movements.insert': {
      const qtyMilli = integer(after.qty_milli);
      const reason = STOCK_REASON[text(after.reason) ?? ''] ?? text(after.reason);
      const quantity =
        qtyMilli === null
          ? null
          : `${qtyMilli > 0 ? '+' : ''}${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(qtyMilli / 1000)}`;
      return { title: 'Lagerbewegung', detail: [quantity, reason].filter(Boolean).join(' · ') || null };
    }

    case 'tenant_members.insert': {
      const role = roleName(after.role);
      return { title: `${staffName(after, entry.entityId)} hinzugefügt`, detail: role ? `Rolle: ${role}` : null };
    }
    case 'tenant_members.update': {
      const name = (entry.entityId && names.byMemberId.get(entry.entityId)) ?? 'Mitarbeiter';
      if ('deactivated_at' in changed) {
        return changed.deactivated_at.new === null || changed.deactivated_at.new === undefined
          ? { title: `${name} wieder aktiviert`, detail: null }
          : { title: `${name} deaktiviert`, detail: 'Der Zugang wurde gesperrt.' };
      }
      if (changed.role) {
        return {
          title: `Rolle von ${name} geändert`,
          detail: `${roleName(changed.role.old) ?? '–'} → ${roleName(changed.role.new) ?? '–'}`,
        };
      }
      if (changed.display_name) {
        return { title: 'Name eines Mitarbeiters geändert', detail: `${text(changed.display_name.old) ?? '–'} → ${text(changed.display_name.new) ?? '–'}` };
      }
      return { title: `${name} geändert`, detail: null };
    }
    case 'tenant_members.delete':
      return { title: `${staffName(before, entry.entityId)} entfernt`, detail: null };

    default:
      return { title: action, detail: null };
  }
}
