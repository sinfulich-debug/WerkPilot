import { config as loadEnv } from 'dotenv';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { tenantMembers, tenantProfiles, tenants } from '../db/schema';

loadEnv({ path: '.env.local' });

class CliError extends Error {}

type CreateTenantResult = 'created' | 'already-assigned';

function parseArguments(args: string[]): { email: string; name: string } {
  let email: string | undefined;
  let name: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new CliError('Verwendung: npm run tenant:create -- --email <E-Mail> --name <Werkstattname>');
    }
    if (option === '--email' && !email) {
      email = value.trim();
    } else if (option === '--name' && !name) {
      name = value.trim();
    } else {
      throw new CliError(`Unbekannte oder doppelte Option: ${option}`);
    }
    index += 1;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
    throw new CliError('Eine gültige --email und ein nicht leerer --name sind erforderlich.');
  }

  return { email, name };
}

async function createTenant(email: string, name: string): Promise<CreateTenantResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new CliError('DATABASE_URL ist nicht gesetzt.');

  const client = postgres(connectionString, { max: 1 });
  const database = drizzle(client, { schema });

  try {
    return await database.transaction(async (tx) => {
      const users = await tx.execute(sql<{ id: string }>`
        SELECT id
        FROM auth.users
        WHERE lower(email) = lower(${email})
        LIMIT 1
        FOR UPDATE
      `);
      const userId = users[0]?.id;
      if (typeof userId !== 'string') {
        throw new CliError('Kein Benutzer mit dieser E-Mail-Adresse gefunden.');
      }

      const existingMembership = await tx
        .select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userId))
        .limit(1);
      if (existingMembership.length > 0) return 'already-assigned';

      const [tenant] = await tx
        .insert(tenants)
        .values({ name })
        .returning({ id: tenants.id });
      if (!tenant) throw new Error('Die Werkstatt konnte nicht angelegt werden.');

      await tx.insert(tenantMembers).values({
        tenantId: tenant.id,
        userId,
        role: 'owner',
      });
      await tx.insert(tenantProfiles).values({
        tenantId: tenant.id,
        companyName: name,
      });

      return 'created';
    });
  } finally {
    await client.end();
  }
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

async function main(): Promise<void> {
  const { email, name } = parseArguments(process.argv.slice(2));
  const result = await createTenant(email, name);

  if (result === 'already-assigned') {
    console.log('Der Benutzer ist bereits einer Werkstatt zugeordnet. Es wurde nichts angelegt.');
    return;
  }

  console.log(`Werkstatt "${name}" angelegt und dem Benutzer als Inhaber zugeordnet.`);
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
  } else {
    const code = getDatabaseErrorCode(error);
    console.error(`Tenant-Erstellung fehlgeschlagen${code ? ` (Datenbankfehler ${code})` : '.'}`);
  }
  process.exitCode = 1;
});
