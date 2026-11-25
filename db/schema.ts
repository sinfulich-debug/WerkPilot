import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  boolean,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { MAX_DECISION_NOTE_LENGTH, MAX_SIGNER_NAME_LENGTH, MIN_SIGNER_NAME_LENGTH } from '../lib/estimate-approval';
import { MAX_INSPECTION_PHOTO_CHARS } from '../lib/inspections';
import {
  MAX_SLOT_LENGTH,
  MAX_TIRE_LABEL_LENGTH,
  MAX_TIRE_NOTES_LENGTH,
  MAX_TREAD_DEPTH_TENTH_MM,
} from '../lib/tire-storage';
import {
  DEFAULT_HOURLY_RATE_CENTS,
  MAX_HOURLY_RATE_CENTS,
  MAX_WHATSAPP_TEMPLATE_LENGTH,
} from '../lib/workshop-settings';

const authUsers = pgSchema('auth').table('users', {
  id: uuid('id').primaryKey(),
});

export const tenantRole = pgEnum('tenant_role', ['owner', 'office', 'mechanic']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'issued', 'cancelled']);
export const appointmentStatus = pgEnum('appointment_status', ['Bestätigt', 'Ausstehend', 'Abgeschlossen']);
export const workOrderStatus = pgEnum('work_order_status', [
  'draft',
  'estimate',
  'approved',
  'in_progress',
  'completed',
  'invoiced',
]);
export const workOrderLineKind = pgEnum('work_order_line_kind', ['labor', 'part']);
export const stockMovementReason = pgEnum('stock_movement_reason', ['purchase', 'work_order', 'correction']);
export const absenceType = pgEnum('absence_type', ['Urlaub', 'Krank', 'Schule']);

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // set by register_workshop (self-registration): when the owner accepted AGB and Datenschutz
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
});

export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => authUsers.id),
    role: tenantRole('role').notNull(),
    // Shown in the calendar and the staff list. Nullable: members made before this column existed have no name.
    displayName: varchar('display_name', { length: 120 }),
    // Deactivation instead of deletion (audit trail). A deactivated member loses all access.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tenant_members_tenant_user_unique').on(table.tenantId, table.userId),
    index('tenant_members_user_id_idx').on(table.userId),
  ],
);

export const tenantProfiles = pgTable(
  'tenant_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyName: varchar('company_name', { length: 200 }).notNull(),
    ownerName: varchar('owner_name', { length: 200 }),
    street: varchar('street', { length: 200 }),
    zip: varchar('zip', { length: 20 }),
    city: varchar('city', { length: 120 }),
    phone: varchar('phone', { length: 40 }),
    email: varchar('email', { length: 320 }),
    website: varchar('website', { length: 500 }),
    taxNumber: varchar('tax_number', { length: 80 }),
    vatId: varchar('vat_id', { length: 40 }),
    bankName: varchar('bank_name', { length: 200 }),
    iban: varchar('iban', { length: 34 }),
    bic: varchar('bic', { length: 11 }),
    isSmallBusiness: boolean('is_small_business').notNull().default(false),
    // Calendar settings: Bundesland decides the public holidays, times are 'HH:MM'.
    bundesland: varchar('bundesland', { length: 2 }).notNull().default('BW'),
    workStart: varchar('work_start', { length: 5 }).notNull().default('08:00'),
    workEnd: varchar('work_end', { length: 5 }).notNull().default('17:00'),
    lunchStart: varchar('lunch_start', { length: 5 }).notNull().default('12:00'),
    lunchEnd: varchar('lunch_end', { length: 5 }).notNull().default('13:00'),
    // Everyday settings: hourly rate in whole cents, own WhatsApp reminder text (null = default text).
    hourlyRateCents: integer('hourly_rate_cents').notNull().default(DEFAULT_HOURLY_RATE_CENTS),
    whatsappTemplate: text('whatsapp_template'),
    // Onboarding: Bundesland has a default ('BW'), so only an explicit save of the calendar settings counts as
    // "chosen". Dismissed = the owner hid the first-run checklist on the dashboard.
    calendarConfirmedAt: timestamp('calendar_confirmed_at', { withTimezone: true }),
    onboardingDismissedAt: timestamp('onboarding_dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tenant_profiles_tenant_id_unique').on(table.tenantId),
    check(
      'tenant_profiles_hourly_rate_range',
      sql`${table.hourlyRateCents} >= 0 AND ${table.hourlyRateCents} <= ${sql.raw(String(MAX_HOURLY_RATE_CENTS))}`,
    ),
    check(
      'tenant_profiles_whatsapp_template_length',
      sql`${table.whatsappTemplate} IS NULL OR char_length(${table.whatsappTemplate}) <= ${sql.raw(String(MAX_WHATSAPP_TEMPLATE_LENGTH))}`,
    ),
    check(
      'tenant_profiles_bundesland_valid',
      sql`${table.bundesland} IN ('BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH')`,
    ),
    check(
      'tenant_profiles_hours_format',
      sql`${table.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND ${table.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND ${table.lunchStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND ${table.lunchEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'tenant_profiles_hours_order',
      sql`${table.workStart} < ${table.workEnd} AND ${table.lunchStart} <= ${table.lunchEnd}`,
    ),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: varchar('name', { length: 200 }).notNull(),
    email: varchar('email', { length: 320 }),
    phone: varchar('phone', { length: 40 }),
    notes: text('notes'),
    street: varchar('street', { length: 200 }),
    zip: varchar('zip', { length: 20 }),
    city: varchar('city', { length: 120 }),
    // HU reminder consent (DSGVO): sending is allowed while consent is newer than any opt-out.
    reminderConsentAt: timestamp('reminder_consent_at', { withTimezone: true }),
    reminderConsentSource: varchar('reminder_consent_source', { length: 10 }),
    reminderOptOutAt: timestamp('reminder_opt_out_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('customers_tenant_id_id_unique').on(table.tenantId, table.id),
    index('customers_tenant_id_idx').on(table.tenantId),
    check(
      'customers_reminder_consent_source_valid',
      sql`${table.reminderConsentSource} IS NULL OR ${table.reminderConsentSource} IN ('verbal','written','form')`,
    ),
    check(
      'customers_reminder_consent_source_required',
      sql`(${table.reminderConsentAt} IS NULL) = (${table.reminderConsentSource} IS NULL)`,
    ),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    customerId: uuid('customer_id').notNull(),
    plate: varchar('plate', { length: 20 }).notNull(),
    make: varchar('make', { length: 100 }).notNull(),
    model: varchar('model', { length: 150 }).notNull(),
    vin: varchar('vin', { length: 17 }),
    hsn: varchar('hsn', { length: 4 }),
    tsn: varchar('tsn', { length: 3 }),
    year: integer('year'),
    engine: varchar('engine', { length: 200 }),
    huDueDate: date('hu_due_date'),
    tuvIntervalMonths: integer('tuv_interval_months'),
    lastReminderSentAt: date('last_reminder_sent_at'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('vehicles_tenant_id_id_unique').on(table.tenantId, table.id),
    foreignKey({
      name: 'vehicles_tenant_customer_fk',
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    index('vehicles_tenant_id_idx').on(table.tenantId),
    index('vehicles_customer_id_idx').on(table.customerId),
  ],
);

export const parts = pgTable(
  'parts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    sku: varchar('sku', { length: 80 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    purchasePriceCents: integer('purchase_price_cents').notNull(),
    salePriceCents: integer('sale_price_cents').notNull(),
    minStockMilli: integer('min_stock_milli').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('parts_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('parts_tenant_sku_unique').on(table.tenantId, table.sku),
    check('parts_purchase_price_nonnegative', sql`${table.purchasePriceCents} >= 0`),
    check('parts_sale_price_nonnegative', sql`${table.salePriceCents} >= 0`),
    check('parts_min_stock_nonnegative', sql`${table.minStockMilli} >= 0`),
    index('parts_tenant_id_idx').on(table.tenantId),
  ],
);

export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    customerId: uuid('customer_id').notNull(),
    vehicleId: uuid('vehicle_id').notNull(),
    number: varchar('number', { length: 40 }).notNull(),
    status: workOrderStatus('status').notNull().default('draft'),
    description: text('description').notNull(),
    workstation: varchar('workstation', { length: 120 }).notNull().default('Direktannahme'),
    mechanic: varchar('mechanic', { length: 200 }).notNull().default('Unzugewiesen'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('work_orders_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('work_orders_tenant_number_unique').on(table.tenantId, table.number),
    foreignKey({
      name: 'work_orders_tenant_customer_fk',
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'work_orders_tenant_vehicle_fk',
      columns: [table.tenantId, table.vehicleId],
      foreignColumns: [vehicles.tenantId, vehicles.id],
    }),
    index('work_orders_tenant_id_idx').on(table.tenantId),
    index('work_orders_customer_id_idx').on(table.customerId),
    index('work_orders_vehicle_id_idx').on(table.vehicleId),
  ],
);

export const workOrderLines = pgTable(
  'work_order_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    workOrderId: uuid('work_order_id').notNull(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    kind: workOrderLineKind('kind').notNull().default('labor'),
    qtyMilli: integer('qty_milli').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull(),
    discountBp: integer('discount_bp').notNull().default(0),
    partId: uuid('part_id'),
    purchasePriceCents: integer('purchase_price_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('work_order_lines_tenant_id_id_unique').on(table.tenantId, table.id),
    foreignKey({
      name: 'work_order_lines_tenant_work_order_fk',
      columns: [table.tenantId, table.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    foreignKey({
      name: 'work_order_lines_tenant_part_fk',
      columns: [table.tenantId, table.partId],
      foreignColumns: [parts.tenantId, parts.id],
    }),
    check(
      'work_order_lines_purchase_price_nonnegative',
      sql`${table.purchasePriceCents} IS NULL OR ${table.purchasePriceCents} >= 0`,
    ),
    index('work_order_lines_tenant_id_idx').on(table.tenantId),
    index('work_order_lines_work_order_id_idx').on(table.workOrderId),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    partId: uuid('part_id').notNull(),
    qtyMilli: integer('qty_milli').notNull(),
    reason: stockMovementReason('reason').notNull(),
    workOrderLineId: uuid('work_order_line_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'stock_movements_tenant_part_fk',
      columns: [table.tenantId, table.partId],
      foreignColumns: [parts.tenantId, parts.id],
    }),
    foreignKey({
      name: 'stock_movements_tenant_work_order_line_fk',
      columns: [table.tenantId, table.workOrderLineId],
      foreignColumns: [workOrderLines.tenantId, workOrderLines.id],
    }),
    check('stock_movements_qty_nonzero', sql`${table.qtyMilli} <> 0`),
    index('stock_movements_tenant_part_created_idx').on(table.tenantId, table.partId, table.createdAt),
    index('stock_movements_work_order_line_idx').on(table.workOrderLineId),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    customerId: uuid('customer_id').notNull(),
    vehicleId: uuid('vehicle_id'),
    workOrderId: uuid('work_order_id'),
    status: invoiceStatus('status').notNull().default('draft'),
    number: varchar('number', { length: 40 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    serviceDate: date('service_date'),
    dueDate: date('due_date'),
    sellerSnapshot: jsonb('seller_snapshot').notNull(),
    buyerSnapshot: jsonb('buyer_snapshot').notNull(),
    cancelsInvoiceId: uuid('cancels_invoice_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('invoices_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('invoices_tenant_number_unique').on(table.tenantId, table.number),
    foreignKey({
      name: 'invoices_tenant_customer_fk',
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'invoices_tenant_vehicle_fk',
      columns: [table.tenantId, table.vehicleId],
      foreignColumns: [vehicles.tenantId, vehicles.id],
    }),
    foreignKey({
      name: 'invoices_tenant_work_order_fk',
      columns: [table.tenantId, table.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    foreignKey({
      name: 'invoices_tenant_cancels_invoice_fk',
      columns: [table.tenantId, table.cancelsInvoiceId],
      foreignColumns: [table.tenantId, table.id],
    }),
    check(
      'invoices_issued_has_number_and_date',
      sql`${table.status} <> 'issued' OR (${table.number} IS NOT NULL AND ${table.issuedAt} IS NOT NULL)`,
    ),
    index('invoices_tenant_id_idx').on(table.tenantId),
    index('invoices_customer_id_idx').on(table.customerId),
    index('invoices_vehicle_id_idx').on(table.vehicleId),
    index('invoices_work_order_id_idx').on(table.workOrderId),
    index('invoices_cancels_invoice_id_idx').on(table.cancelsInvoiceId),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    qtyMilli: integer('qty_milli').notNull(),
    // UN/ECE Recommendation 20 unit code (C62 piece, HUR hour, ...), required by the e-invoice format.
    unitCode: varchar('unit_code', { length: 3 }).notNull().default('C62'),
    unitPriceCents: integer('unit_price_cents').notNull(),
    taxRateBp: integer('tax_rate_bp').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'invoice_lines_tenant_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    check(
      'invoice_lines_unit_code_valid',
      sql`${table.unitCode} IN ('C62','HUR','LS','SET','LTR','KGM','MTR')`,
    ),
    index('invoice_lines_tenant_id_idx').on(table.tenantId),
    index('invoice_lines_invoice_id_idx').on(table.invoiceId),
  ],
);

export const invoiceSequences = pgTable(
  'invoice_sequences',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.year], name: 'invoice_sequences_pk' }),
    uniqueIndex('invoice_sequences_id_unique').on(table.id),
    index('invoice_sequences_tenant_id_idx').on(table.tenantId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    method: varchar('method', { length: 40 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'payments_tenant_invoice_fk',
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    index('payments_tenant_id_idx').on(table.tenantId),
    index('payments_invoice_id_idx').on(table.invoiceId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').references(() => authUsers.id),
    action: varchar('action', { length: 120 }).notNull(),
    entity: varchar('entity', { length: 120 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_tenant_id_idx').on(table.tenantId),
    index('audit_log_user_id_idx').on(table.userId),
    index('audit_log_entity_id_idx').on(table.entityId),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    date: date('date').notNull(),
    time: varchar('time', { length: 5 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    bay: varchar('bay', { length: 120 }).notNull().default('Direktannahme'),
    mechanicId: uuid('mechanic_id'),
    customerId: uuid('customer_id'),
    vehicleId: uuid('vehicle_id'),
    customer: varchar('customer', { length: 200 }).notNull(),
    vehicle: varchar('vehicle', { length: 200 }).notNull(),
    plate: varchar('plate', { length: 20 }).notNull(),
    vehicleYear: integer('vehicle_year'),
    hsn: varchar('hsn', { length: 4 }),
    tsn: varchar('tsn', { length: 3 }),
    vin: varchar('vin', { length: 17 }),
    engine: varchar('engine', { length: 200 }),
    tuvIntervalMonths: integer('tuv_interval_months'),
    tuvDueDate: date('tuv_due_date'),
    reason: text('reason').notNull(),
    status: appointmentStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'appointments_tenant_mechanic_fk',
      columns: [table.tenantId, table.mechanicId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    check('appointments_duration_minutes_positive', sql`${table.durationMinutes} > 0`),
    index('appointments_tenant_date_time_idx').on(table.tenantId, table.date, table.time),
  ],
);

/** What the workshop wrote into the fill-in fields of its Verfahrensdokumentation. */
export const processDocumentationAnswers = pgTable(
  'process_documentation_answers',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    fieldKey: varchar('field_key', { length: 60 }).notNull(),
    answer: text('answer').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.fieldKey], name: 'process_documentation_answers_pk' }),
    check('process_documentation_answers_length', sql`char_length(${table.answer}) <= 4000`),
    check('process_documentation_answers_key_format', sql`${table.fieldKey} ~ '^[a-z0-9-]{1,60}$'`),
  ],
);

export const absences = pgTable(
  'absences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    mechanicId: uuid('mechanic_id').notNull(),
    // Inclusive date range in Europe/Berlin calendar days.
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    type: absenceType('type').notNull(),
    note: varchar('note', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'absences_tenant_mechanic_fk',
      columns: [table.tenantId, table.mechanicId],
      foreignColumns: [tenantMembers.tenantId, tenantMembers.userId],
    }),
    check('absences_date_order', sql`${table.endDate} >= ${table.startDate}`),
    index('absences_tenant_dates_idx').on(table.tenantId, table.startDate, table.endDate),
    index('absences_mechanic_idx').on(table.mechanicId),
  ],
);


// Vehicle inspection (DVI / Annahmeprotokoll). Customer, vehicle and plate are free text like before;
// customer_id / vehicle_id can link the inspection to the customer file later (optional).
export const vehicleInspections = pgTable(
  'vehicle_inspections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    customerName: varchar('customer_name', { length: 200 }).notNull().default(''),
    vehicleLabel: varchar('vehicle_label', { length: 200 }).notNull().default(''),
    plate: varchar('plate', { length: 20 }).notNull().default(''),
    customerId: uuid('customer_id'),
    vehicleId: uuid('vehicle_id'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('vehicle_inspections_tenant_id_id_unique').on(table.tenantId, table.id),
    foreignKey({
      name: 'vehicle_inspections_tenant_customer_fk',
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'vehicle_inspections_tenant_vehicle_fk',
      columns: [table.tenantId, table.vehicleId],
      foreignColumns: [vehicles.tenantId, vehicles.id],
    }),
    index('vehicle_inspections_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);

export const vehicleInspectionItems = pgTable(
  'vehicle_inspection_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    inspectionId: uuid('inspection_id').notNull(),
    position: integer('position').notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('gruen'),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('vehicle_inspection_items_tenant_id_id_unique').on(table.tenantId, table.id),
    foreignKey({
      name: 'vehicle_inspection_items_tenant_inspection_fk',
      columns: [table.tenantId, table.inspectionId],
      foreignColumns: [vehicleInspections.tenantId, vehicleInspections.id],
    }).onDelete('cascade'),
    check('vehicle_inspection_items_status_valid', sql`${table.status} IN ('gruen', 'gelb', 'rot')`),
    check('vehicle_inspection_items_note_length', sql`char_length(${table.note}) <= 2000`),
    check('vehicle_inspection_items_label_not_blank', sql`char_length(btrim(${table.label})) > 0`),
    index('vehicle_inspection_items_inspection_idx').on(table.inspectionId),
  ],
);

// One photo per checklist item, kept apart from the items so lists load fast.
export const vehicleInspectionPhotos = pgTable(
  'vehicle_inspection_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    itemId: uuid('item_id').notNull(),
    dataUrl: text('data_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('vehicle_inspection_photos_item_unique').on(table.itemId),
    foreignKey({
      name: 'vehicle_inspection_photos_tenant_item_fk',
      columns: [table.tenantId, table.itemId],
      foreignColumns: [vehicleInspectionItems.tenantId, vehicleInspectionItems.id],
    }).onDelete('cascade'),
    check(
      'vehicle_inspection_photos_size',
      sql`char_length(${table.dataUrl}) <= ${sql.raw(String(MAX_INSPECTION_PHOTO_CHARS))}`,
    ),
    // chr(59) is ";" - written this way because drizzle-kit cuts SQL strings at a semicolon
    check(
      'vehicle_inspection_photos_jpeg',
      sql`starts_with(${table.dataUrl}, 'data:image/jpeg' || chr(59) || 'base64,')`,
    ),
    index('vehicle_inspection_photos_tenant_idx').on(table.tenantId),
  ],
);


// Customer approval of an estimate by link (no login). Only the SHA-256 hash of the secret token is
// stored. A decision (approved/declined) is evidence and can never change afterwards (trigger in 0024).
export const estimateApprovals = pgTable(
  'estimate_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    workOrderId: uuid('work_order_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    // The employee who made the link. The customer's answer runs on behalf of this member (RLS applies).
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Gross total (cents) the customer saw; compared again when the customer answers.
    totalGrossCents: integer('total_gross_cents').notNull(),
    decision: varchar('decision', { length: 10 }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    signerName: varchar('signer_name', { length: MAX_SIGNER_NAME_LENGTH }).notNull().default(''),
    decisionNote: varchar('decision_note', { length: MAX_DECISION_NOTE_LENGTH }).notNull().default(''),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('estimate_approvals_token_hash_unique').on(table.tokenHash),
    index('estimate_approvals_work_order_idx').on(table.tenantId, table.workOrderId),
    foreignKey({
      name: 'estimate_approvals_tenant_work_order_fk',
      columns: [table.tenantId, table.workOrderId],
      foreignColumns: [workOrders.tenantId, workOrders.id],
    }),
    check('estimate_approvals_token_hash_format', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('estimate_approvals_expiry_after_creation', sql`${table.expiresAt} > ${table.createdAt}`),
    check('estimate_approvals_total_not_negative', sql`${table.totalGrossCents} >= 0`),
    check('estimate_approvals_decision_valid', sql`${table.decision} IS NULL OR ${table.decision} IN ('approved', 'declined')`),
    check('estimate_approvals_decision_has_time', sql`(${table.decision} IS NULL) = (${table.decidedAt} IS NULL)`),
    check(
      'estimate_approvals_approval_has_name',
      sql`${table.decision} IS DISTINCT FROM 'approved' OR char_length(btrim(${table.signerName})) >= ${sql.raw(String(MIN_SIGNER_NAME_LENGTH))}`,
    ),
  ],
);

// Tire storage (Reifenlager): one row per stored set of wheels. A set that leaves the storage gets
// released_at (archived, never deleted). A shelf slot holds only one stored set at a time.
export const tireStorages = pgTable(
  'tire_storages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    customerId: uuid('customer_id').notNull(),
    vehicleId: uuid('vehicle_id'),
    slot: varchar('slot', { length: MAX_SLOT_LENGTH }).notNull(),
    season: varchar('season', { length: 10 }).notNull(),
    description: varchar('description', { length: MAX_TIRE_LABEL_LENGTH }).notNull(),
    treadDepthTenthMm: integer('tread_depth_tenth_mm'),
    storedAt: date('stored_at').notNull(),
    releasedAt: date('released_at'),
    lastReminderSentAt: date('last_reminder_sent_at'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'tire_storages_tenant_customer_fk',
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'tire_storages_tenant_vehicle_fk',
      columns: [table.tenantId, table.vehicleId],
      foreignColumns: [vehicles.tenantId, vehicles.id],
    }),
    uniqueIndex('tire_storages_active_slot_unique')
      .on(table.tenantId, table.slot)
      .where(sql`${table.releasedAt} IS NULL`),
    index('tire_storages_tenant_customer_idx').on(table.tenantId, table.customerId),
    check('tire_storages_season_valid', sql`${table.season} IN ('summer','winter','allseason')`),
    check('tire_storages_slot_not_blank', sql`char_length(btrim(${table.slot})) > 0`),
    check('tire_storages_description_not_blank', sql`char_length(btrim(${table.description})) > 0`),
    check(
      'tire_storages_tread_depth_range',
      sql`${table.treadDepthTenthMm} IS NULL OR (${table.treadDepthTenthMm} >= 0 AND ${table.treadDepthTenthMm} <= ${sql.raw(String(MAX_TREAD_DEPTH_TENTH_MM))})`,
    ),
    check('tire_storages_notes_length', sql`${table.notes} IS NULL OR char_length(${table.notes}) <= ${sql.raw(String(MAX_TIRE_NOTES_LENGTH))}`),
    check('tire_storages_release_after_store', sql`${table.releasedAt} IS NULL OR ${table.releasedAt} >= ${table.storedAt}`),
  ],
);

// Request counters for the public (no-login) approval link, one row per hashed client address and
// scope. Only the SECURITY DEFINER function hit_public_rate_limit touches it (migration 0028).
export const publicRateLimits = pgTable(
  'public_rate_limits',
  {
    bucket: varchar('bucket', { length: 64 }).primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull(),
  },
  (table) => [
    check('public_rate_limits_bucket_hex', sql`${table.bucket} ~ '^[0-9a-f]{64}$'`),
    check('public_rate_limits_hits_positive', sql`${table.hits} > 0`),
    index('public_rate_limits_window_start_idx').on(table.windowStart),
  ],
);

// Trial and Stripe subscription of a workshop (migration 0030). Members may read it; nobody writes it
// directly: register_workshop starts the trial, apply_stripe_billing (role billing_webhook) mirrors Stripe.
// No row = workshop created before self-registration (pilot): billing does not apply.
export const tenantBilling = pgTable('tenant_billing', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }).unique(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  subscriptionStatus: varchar('subscription_status', { length: 40 }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
  stripeEventAt: timestamp('stripe_event_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
