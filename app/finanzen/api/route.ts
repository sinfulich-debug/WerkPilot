import { NextResponse } from 'next/server';
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  getInvoices,
  InvoiceNotEditableError,
  InvoiceNotFoundError,
  issueInvoice,
  updateInvoice,
} from '../../../lib/db/invoices';
import { isAfterTodayInTimeZone } from '../../../lib/date';
import { euroToCents, quantityToMilli, type InvoiceInput } from '../../../lib/finance';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { isUnitCode } from '../../../lib/units';
import { NoTenantError } from '../../../lib/session';

class ValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function requiredId(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError('Die Kennung ist ungültig.');
  }
  return value;
}

function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function requiredDate(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !isValidDateString(value)) {
    throw new ValidationError(`${label} muss im Format YYYY-MM-DD angegeben werden.`);
  }
  return value;
}

function parseInvoiceInput(value: unknown): InvoiceInput {
  if (!isRecord(value)) throw new ValidationError('Ungültige Rechnungsdaten.');

  const customerId = requiredId(value, 'customerId');
  const vehicleId =
    value.vehicleId === undefined || value.vehicleId === null || value.vehicleId === ''
      ? undefined
      : requiredId(value, 'vehicleId');
  const taxMode = value.taxMode;
  if (taxMode !== 'standard19' && taxMode !== 'reduced7' && taxMode !== 'smallBusiness') {
    throw new ValidationError('Die Steuerregel ist ungültig.');
  }

  if (!Array.isArray(value.lines) || value.lines.length === 0 || value.lines.length > 100) {
    throw new ValidationError('Eine Rechnung benötigt mindestens eine gültige Position.');
  }

  const lines = value.lines.map((valueLine, index) => {
    if (!isRecord(valueLine)) {
      throw new ValidationError(`Position ${index + 1} ist ungültig.`);
    }

    const description = valueLine.description;
    if (typeof description !== 'string' || !description.trim()) {
      throw new ValidationError(`Die Bezeichnung von Position ${index + 1} darf nicht leer sein.`);
    }

    const quantity = valueLine.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
      throw new ValidationError(`Die Menge von Position ${index + 1} ist ungültig.`);
    }

    const unitPrice = valueLine.unitPrice;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice)) {
      throw new ValidationError(`Der Einzelpreis von Position ${index + 1} ist ungültig.`);
    }

    try {
      quantityToMilli(quantity);
      euroToCents(unitPrice);
    } catch {
      throw new ValidationError(`Menge oder Einzelpreis von Position ${index + 1} ist ungültig.`);
    }

    const unit = valueLine.unit;
    if (unit !== undefined && unit !== null && unit !== '' && !isUnitCode(unit)) {
      throw new ValidationError(`Die Einheit von Position ${index + 1} ist ungültig.`);
    }

    return { description: description.trim(), quantity, unitPrice, ...(isUnitCode(unit) && { unit }) };
  });

  return {
    customerId,
    vehicleId,
    serviceDate: requiredDate(value, 'serviceDate', 'Das Leistungsdatum'),
    dueAt: requiredDate(value, 'dueAt', 'Das Fälligkeitsdatum'),
    taxMode,
    lines,
  };
}

function parsePayment(value: unknown): {
  invoiceId: string;
  amount: number;
  paidAt: string;
} {
  if (!isRecord(value)) throw new ValidationError('Ungültige Zahlungsdaten.');

  const invoiceId = requiredId(value, 'invoiceId');
  const amount = value.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Der Zahlungsbetrag muss größer als 0 sein.');
  }
  try {
    euroToCents(amount);
  } catch {
    throw new ValidationError('Der Zahlungsbetrag muss auf höchstens zwei Nachkommastellen genau sein.');
  }

  const paidAt = value.paidAt;
  if (typeof paidAt !== 'string' || !paidAt.trim() || Number.isNaN(new Date(paidAt).getTime())) {
    throw new ValidationError('Das Zahlungsdatum ist ungültig.');
  }
  // the dialog checks this too, but the API must not rely on the browser (reports would book it in a later period)
  if (isAfterTodayInTimeZone(new Date(paidAt), new Date())) {
    throw new ValidationError('Das Zahlungsdatum darf nicht in der Zukunft liegen.');
  }

  return { invoiceId, amount, paidAt: new Date(paidAt).toISOString() };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: 'Für Finanzen fehlt die erforderliche Berechtigung.' }, { status: 403 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof InvoiceNotEditableError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof InvoiceNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  }

  console.error('Rechnungen konnten nicht verarbeitet werden.', error);
  return NextResponse.json(
    { ok: false, error: 'Rechnungen konnten nicht verarbeitet werden.' },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const invoices = await getInvoices(tenantId);
    return NextResponse.json({ ok: true, invoices });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  const actions = [
    'createInvoice',
    'updateInvoice',
    'issueInvoice',
    'deleteInvoice',
    'addPayment',
    'cancelInvoice',
  ];
  if (!action || !actions.includes(action)) {
    return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
  }

  try {
    const { tenantId, userId } = await requireRole(['owner', 'office', 'mechanic']);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Ungültige JSON-Anfrage.');
    }
    if (!isRecord(body)) throw new ValidationError('Ungültige Anfrage.');

    switch (action) {
      case 'createInvoice': {
        const invoice = await createInvoice(tenantId, parseInvoiceInput(body));
        return NextResponse.json({ ok: true, invoice });
      }
      case 'updateInvoice': {
        const id = requiredId(body, 'id');
        const invoice = await updateInvoice(tenantId, id, parseInvoiceInput(body));
        // never answer "ok" when nothing was saved
        if (!invoice) throw new InvoiceNotFoundError();
        return NextResponse.json({ ok: true, invoice });
      }
      case 'issueInvoice': {
        // issuing runs without the user's database session, so the audit log is told who acts
        const number = await issueInvoice(tenantId, requiredId(body, 'id'), userId);
        return NextResponse.json({ ok: true, number });
      }
      case 'deleteInvoice': {
        await deleteInvoice(tenantId, requiredId(body, 'id'));
        return NextResponse.json({ ok: true });
      }
      case 'cancelInvoice': {
        const result = await cancelInvoice(tenantId, requiredId(body, 'id'), userId);
        return NextResponse.json({ ok: true, number: result.number, cancellationId: result.cancellationId });
      }
      case 'addPayment': {
        const payment = parsePayment(body);
        const savedPayment = await addPayment(
          tenantId,
          payment.invoiceId,
          payment.amount,
          payment.paidAt,
        );
        return NextResponse.json({ ok: true, payment: savedPayment });
      }
      default:
        return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
