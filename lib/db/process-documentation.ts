import 'server-only';

import { and, eq } from 'drizzle-orm';
import { processDocumentationAnswers } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';

/** All saved answers of the workshop, by field key. */
export async function getProcessAnswers(tenantId: string): Promise<Record<string, string>> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select({ fieldKey: processDocumentationAnswers.fieldKey, answer: processDocumentationAnswers.answer })
      .from(processDocumentationAnswers)
      .where(eq(processDocumentationAnswers.tenantId, tenantId));
    return Object.fromEntries(rows.map((row) => [row.fieldKey, row.answer]));
  });
}

/** Saves one answer; an empty answer removes it, so a cleared field is a field that was never filled in. */
export async function saveProcessAnswer(tenantId: string, userId: string, fieldKey: string, answer: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    if (answer === '') {
      await tx
        .delete(processDocumentationAnswers)
        .where(and(eq(processDocumentationAnswers.tenantId, tenantId), eq(processDocumentationAnswers.fieldKey, fieldKey)));
      return;
    }
    await tx
      .insert(processDocumentationAnswers)
      .values({ tenantId, fieldKey, answer, updatedBy: userId })
      .onConflictDoUpdate({
        target: [processDocumentationAnswers.tenantId, processDocumentationAnswers.fieldKey],
        set: { answer, updatedBy: userId, updatedAt: new Date() },
      });
  });
}
