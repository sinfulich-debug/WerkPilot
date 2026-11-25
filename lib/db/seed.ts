import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import 'dotenv/config';
import * as schema from '../../db/schema';
import { customers, tenants, vehicles, workOrderLines, workOrders } from '../../db/schema';

const tenantId = '8a32e193-c98d-4c0a-a86a-67f2edbd0001';

const demoCustomers = [
  {
    id: '8a32e193-c98d-4c0a-a86a-67f2edbd0002',
    name: 'Anna Müller',
    phone: '+49 711 123456',
    email: 'anna.mueller@example.de',
    notes: 'Bevorzugt vormittags',
    vehicleId: '8a32e193-c98d-4c0a-a86a-67f2edbd0005',
    make: 'VW',
    model: 'Golf VIII',
    plate: 'S-WN 1234',
    orderId: '8a32e193-c98d-4c0a-a86a-67f2edbd0008',
    orderLineId: '8a32e193-c98d-4c0a-a86a-67f2edbd0011',
    orderNumber: 'AU-2026-0241',
    service: 'Bremsenprüfung',
    hours: 2,
    workstation: 'Direktannahme',
    mechanic: 'Jonas Weber',
  },
  {
    id: '8a32e193-c98d-4c0a-a86a-67f2edbd0003',
    name: 'Thomas Schneider',
    phone: '+49 711 234567',
    email: 'thomas.schneider@example.de',
    vehicleId: '8a32e193-c98d-4c0a-a86a-67f2edbd0006',
    make: 'BMW',
    model: '320d',
    plate: 'WN-AB 88',
    orderId: '8a32e193-c98d-4c0a-a86a-67f2edbd0009',
    orderLineId: '8a32e193-c98d-4c0a-a86a-67f2edbd0012',
    orderNumber: 'AU-2026-0242',
    service: 'Räderwechsel',
    hours: 1.5,
    workstation: 'Reifen 1',
    mechanic: 'Mia Schneider',
  },
  {
    id: '8a32e193-c98d-4c0a-a86a-67f2edbd0004',
    name: 'Julia Keller',
    phone: '+49 711 345678',
    email: 'julia.keller@example.de',
    vehicleId: '8a32e193-c98d-4c0a-a86a-67f2edbd0007',
    make: 'Mercedes',
    model: 'C-Klasse',
    plate: 'M-TR 4052',
    orderId: '8a32e193-c98d-4c0a-a86a-67f2edbd0010',
    orderLineId: '8a32e193-c98d-4c0a-a86a-67f2edbd0013',
    orderNumber: 'AU-2026-0243',
    service: 'Spureinstellung',
    hours: 2.5,
    workstation: 'Achsvermessung',
    mechanic: 'Lukas Fischer',
  },
] as const;

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be set before running the seed.');

  const client = postgres(connectionString);
  const database = drizzle(client, { schema });
  try {
    await database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      await tx.insert(tenants)
        .values({ id: tenantId, name: 'Werkstatt Müller – Demobetrieb' })
        .onConflictDoUpdate({ target: tenants.id, set: { name: 'Werkstatt Müller – Demobetrieb' } });

      for (const customer of demoCustomers) {
        await tx.insert(customers)
          .values({
            id: customer.id,
            tenantId,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            notes: 'notes' in customer ? customer.notes : null,
          })
          .onConflictDoUpdate({
            target: customers.id,
            set: {
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              notes: 'notes' in customer ? customer.notes : null,
            },
          });

        await tx.insert(vehicles)
          .values({
            id: customer.vehicleId,
            tenantId,
            customerId: customer.id,
            make: customer.make,
            model: customer.model,
            plate: customer.plate,
          })
          .onConflictDoUpdate({
            target: vehicles.id,
            set: {
              customerId: customer.id,
              make: customer.make,
              model: customer.model,
              plate: customer.plate,
            },
          });

        await tx.insert(workOrders)
          .values({
            id: customer.orderId,
            tenantId,
            number: customer.orderNumber,
            customerId: customer.id,
            vehicleId: customer.vehicleId,
            description: customer.service,
            workstation: customer.workstation,
            mechanic: customer.mechanic,
            status: 'approved',
          })
          .onConflictDoUpdate({
            target: workOrders.id,
            set: {
              number: customer.orderNumber,
              customerId: customer.id,
              vehicleId: customer.vehicleId,
              description: customer.service,
              workstation: customer.workstation,
              mechanic: customer.mechanic,
              status: 'approved',
            },
          });

        await tx.insert(workOrderLines)
          .values({
            id: customer.orderLineId,
            tenantId,
            workOrderId: customer.orderId,
            position: 1,
            description: customer.service,
            kind: 'labor',
            qtyMilli: Math.round(customer.hours * 1_000),
            unitPriceCents: 9_500,
            taxRateBp: 1_900,
          })
          .onConflictDoUpdate({
            target: workOrderLines.id,
            set: {
              workOrderId: customer.orderId,
              position: 1,
              description: customer.service,
              qtyMilli: Math.round(customer.hours * 1_000),
              unitPriceCents: 9_500,
              taxRateBp: 1_900,
            },
          });
      }

      const currentTenant = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
      if (currentTenant.length !== 1) throw new Error('The demo tenant could not be verified after seeding.');
    });
  } finally {
    await client.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Database seed failed.', error);
  process.exitCode = 1;
});
