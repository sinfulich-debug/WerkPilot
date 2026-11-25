import 'server-only';

import { getSessionContext, type SessionContext } from '../lib/session';
import { withUser, type UserTransaction } from './with-user';

export async function withTenant<T>(
  fn: (tx: UserTransaction, context: SessionContext) => Promise<T> | T,
): Promise<T> {
  const context = await getSessionContext();
  return withUser(context.userId, context.tenantId, (tx) => fn(tx, context));
}

export function assertTenantContext(tenantId: string, context: SessionContext): void {
  if (tenantId !== context.tenantId) {
    throw new Error('Die angeforderte Werkstatt stimmt nicht mit der Sitzung überein.');
  }
}
