import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.log('OK: alle Migrationen angewendet');
} catch (e) {
  console.error('FEHLER:', e.message);
  console.error('URSACHE:', e.cause?.message ?? e.cause ?? '(keine)');
  console.error('DETAIL:', e.cause?.detail ?? '', e.cause?.where ?? '', 'position', e.cause?.position ?? '');
  process.exitCode = 1;
} finally {
  await sql.end();
}