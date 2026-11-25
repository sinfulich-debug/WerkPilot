import { getSessionContext, type Role, type SessionContext } from './session';

export class ForbiddenError extends Error {
  constructor() {
    super('Für diese Aktion fehlt die erforderliche Berechtigung.');
    this.name = 'ForbiddenError';
  }
}

export async function requireRole(allowed: Role[]): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!allowed.includes(context.role)) throw new ForbiddenError();
  return context;
}
