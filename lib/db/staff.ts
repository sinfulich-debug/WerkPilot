import 'server-only';

import { and, eq } from 'drizzle-orm';
import { tenantMembers } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { MemberChange } from '../members';
import type { Role } from '../session';

export type StaffRow = {
  id: string;
  userId: string;
  displayName: string | null;
  role: Role;
  deactivatedAt: Date | null;
};

/** All members of the workshop, deactivated ones included. Row level security lets only the owner see them all. */
export async function listStaff(tenantId: string): Promise<StaffRow[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    return tx
      .select({
        id: tenantMembers.id,
        userId: tenantMembers.userId,
        displayName: tenantMembers.displayName,
        role: tenantMembers.role,
        deactivatedAt: tenantMembers.deactivatedAt,
      })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId));
  });
}

export async function addStaffMember(
  tenantId: string,
  input: { userId: string; displayName: string; role: Role },
): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx.insert(tenantMembers).values({ tenantId, ...input });
  });
}

export async function findStaffMember(tenantId: string, memberId: string): Promise<StaffRow | null> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select({
        id: tenantMembers.id,
        userId: tenantMembers.userId,
        displayName: tenantMembers.displayName,
        role: tenantMembers.role,
        deactivatedAt: tenantMembers.deactivatedAt,
      })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.id, memberId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/** Changes role or deactivation of one member (never the tenant or the user). Returns false if there is no such member. */
export async function updateStaffMember(
  tenantId: string,
  change: Exclude<MemberChange, { type: 'link' }>,
): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const values =
      change.type === 'role'
        ? { role: change.role }
        : change.type === 'deactivate'
          ? { deactivatedAt: new Date() }
          : { deactivatedAt: null };
    const rows = await tx
      .update(tenantMembers)
      .set(values)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.id, change.memberId)))
      .returning({ id: tenantMembers.id });
    return rows.length > 0;
  });
}
