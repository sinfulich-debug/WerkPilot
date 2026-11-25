import 'server-only';

import { and, count, eq, isNull } from 'drizzle-orm';
import { appointments, customers, tenantMembers, tenantProfiles } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { OnboardingFacts } from '../onboarding';

export async function getOnboardingFacts(tenantId: string): Promise<OnboardingFacts> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);

    const [profile] = await tx
      .select({
        companyName: tenantProfiles.companyName,
        street: tenantProfiles.street,
        zip: tenantProfiles.zip,
        city: tenantProfiles.city,
        taxNumber: tenantProfiles.taxNumber,
        vatId: tenantProfiles.vatId,
        calendarConfirmedAt: tenantProfiles.calendarConfirmedAt,
        onboardingDismissedAt: tenantProfiles.onboardingDismissedAt,
      })
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, tenantId))
      .limit(1);

    // One transaction = one connection, so the counts run one after another.
    const [members] = await tx
      .select({ value: count() })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), isNull(tenantMembers.deactivatedAt)));
    const [appointmentRows] = await tx
      .select({ value: count() })
      .from(appointments)
      .where(eq(appointments.tenantId, tenantId));
    const [customerRows] = await tx
      .select({ value: count() })
      .from(customers)
      .where(eq(customers.tenantId, tenantId));

    return {
      profile: profile
        ? {
            companyName: profile.companyName,
            street: profile.street,
            zip: profile.zip,
            city: profile.city,
            taxNumber: profile.taxNumber,
            vatId: profile.vatId,
          }
        : null,
      calendarConfirmed: Boolean(profile?.calendarConfirmedAt),
      activeMembers: Number(members?.value ?? 0),
      appointments: Number(appointmentRows?.value ?? 0),
      customers: Number(customerRows?.value ?? 0),
      dismissed: Boolean(profile?.onboardingDismissedAt),
    };
  });
}

/** Hides the checklist on the dashboard for the whole workshop. Returns false when there is no profile yet. */
export async function dismissOnboarding(tenantId: string): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .update(tenantProfiles)
      .set({ onboardingDismissedAt: new Date() })
      .where(eq(tenantProfiles.tenantId, tenantId))
      .returning({ id: tenantProfiles.id });
    return rows.length > 0;
  });
}
