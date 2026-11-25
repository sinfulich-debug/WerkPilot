import 'server-only';

import { eq } from 'drizzle-orm';
import { tenantProfiles } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import { toWorkshopSettings, type WorkshopSettings } from '../workshop-settings';

export type WorkshopProfileInput = {
  companyName: string;
  ownerName?: string;
  street?: string;
  zip?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxNumber?: string;
  vatId?: string;
  bankName?: string;
  iban?: string;
  bic?: string;
  isSmallBusiness?: boolean;
  /** Whole cents. Not sent = keep the stored rate. */
  hourlyRateCents?: number;
  /** Own reminder text; null = back to the default text; not sent = keep the stored text. */
  whatsappTemplate?: string | null;
};

export type WorkshopProfile = typeof tenantProfiles.$inferSelect;

// Reads and writes run as the signed-in user (withTenant), so the row level security of
// tenant_profiles applies: owner and office may write, mechanics may only read.

export async function getWorkshopProfile(tenantId: string): Promise<WorkshopProfile | null> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [profile] = await tx
      .select()
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, tenantId))
      .limit(1);
    return profile ?? null;
  });
}

/** The everyday settings (hourly rate, reminder text, bank details) for every role of the workshop. */
export async function getWorkshopSettings(tenantId: string): Promise<WorkshopSettings> {
  return toWorkshopSettings(await getWorkshopProfile(tenantId));
}

export async function saveWorkshopProfile(
  tenantId: string,
  data: WorkshopProfileInput,
): Promise<void> {
  const companyName = data.companyName.trim();
  if (!companyName) throw new Error('Der Firmenname darf nicht leer sein.');

  const values = {
    tenantId,
    companyName,
    ownerName: data.ownerName ?? null,
    street: data.street ?? null,
    zip: data.zip ?? null,
    city: data.city ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    website: data.website ?? null,
    taxNumber: data.taxNumber ?? null,
    vatId: data.vatId ?? null,
    bankName: data.bankName ?? null,
    iban: data.iban ?? null,
    bic: data.bic ?? null,
    isSmallBusiness: data.isSmallBusiness ?? false,
  };
  // Only fields that were really sent are written, so saving the form never resets the others.
  const everyday = {
    ...(data.hourlyRateCents !== undefined ? { hourlyRateCents: data.hourlyRateCents } : {}),
    ...(data.whatsappTemplate !== undefined ? { whatsappTemplate: data.whatsappTemplate } : {}),
  };

  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    await tx
      .insert(tenantProfiles)
      .values({ ...values, ...everyday })
      .onConflictDoUpdate({
        target: tenantProfiles.tenantId,
        set: {
          companyName: values.companyName,
          ownerName: values.ownerName,
          street: values.street,
          zip: values.zip,
          city: values.city,
          phone: values.phone,
          email: values.email,
          website: values.website,
          taxNumber: values.taxNumber,
          vatId: values.vatId,
          bankName: values.bankName,
          iban: values.iban,
          bic: values.bic,
          isSmallBusiness: values.isSmallBusiness,
          ...everyday,
        },
      });
  });
}
