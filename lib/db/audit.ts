import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';
import { auditLog } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { memberNamesFromRows, type AuditEntry, type MemberNames } from '../audit-log';

/**
 * Names of all members (deactivated included) for the "Durch" column. The database function returns
 * rows only to active owner/office of the workshop - the same people who may read the log.
 */
export async function getMemberNames(tenantId: string): Promise<MemberNames> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx.execute<{ member_id: string; user_id: string; display_name: string | null }>(
      sql`select member_id, user_id, display_name from public.get_tenant_member_names(${tenantId})`,
    );
    return memberNamesFromRows(
      Array.from(rows, (row) => ({ memberId: row.member_id, userId: row.user_id, displayName: row.display_name })),
    );
  });
}

export const AUDIT_ENTITIES = ['invoices', 'payments', 'work_orders', 'stock_movements', 'tenant_members'] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

const MAX_ENTRIES = 500;

/**
 * The newest audit entries of the workshop, optionally for one kind of record.
 * Reading goes through row-level security: only owner and office see the log of their own workshop.
 */
export async function getAuditLog(
  tenantId: string,
  options: { entity?: AuditEntity; limit?: number } = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 200)), MAX_ENTRIES);
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select()
      .from(auditLog)
      .where(
        options.entity
          ? and(eq(auditLog.tenantId, tenantId), eq(auditLog.entity, options.entity))
          : eq(auditLog.tenantId, tenantId),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      userId: row.userId,
      data: row.data,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}
