import { NextResponse } from 'next/server';
import {
  archivePart,
  createPart,
  getParts,
  PartNotArchivableError,
  PartNotFoundError,
  recordStockMovement,
  updatePart,
} from '../../../lib/db/parts';
import { getDatabaseErrorCode, PG_UNIQUE_VIOLATION } from '../../../lib/db-error';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';
import type { PartInput } from '../../../lib/parts';
import { StockUnavailableError } from '../../../lib/stock';
import type { Part } from '../../../lib/parts';

class ValidationError extends Error {}

function partForRole(part: Part, canViewCosts: boolean): Part | Omit<Part, 'purchasePriceCents'> {
  if (canViewCosts) return part;
  const { purchasePriceCents, ...visiblePart } = part;
  void purchasePriceCents;
  return visiblePart;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(body: Record<string, unknown>, key: string, label: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} darf nicht leer sein.`);
  }
  return value.trim();
}

function requiredInteger(body: Record<string, unknown>, key: string, label: string): number {
  const value = body[key];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Math.abs(value) > 2_147_483_647
  ) {
    throw new ValidationError(`${label} ist ungültig.`);
  }
  return value;
}

function requiredId(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError('Die Ersatzteilkennung ist ungültig.');
  }
  return value;
}

function parsePartInput(body: Record<string, unknown>): PartInput {
  const input = {
    sku: requiredText(body, 'sku', 'Die Artikelnummer'),
    name: requiredText(body, 'name', 'Die Bezeichnung'),
    purchasePriceCents: requiredInteger(body, 'purchasePriceCents', 'Der Einkaufspreis'),
    salePriceCents: requiredInteger(body, 'salePriceCents', 'Der Verkaufspreis'),
    minStockMilli: requiredInteger(body, 'minStockMilli', 'Der Mindestbestand'),
  };
  if (input.sku.length > 80 || input.name.length > 200) {
    throw new ValidationError('Artikelnummer oder Bezeichnung ist zu lang.');
  }
  if (input.purchasePriceCents < 0 || input.salePriceCents < 0 || input.minStockMilli < 0) {
    throw new ValidationError('Preise und Mindestbestand dürfen nicht negativ sein.');
  }
  return input;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  if (error instanceof ValidationError || error instanceof RangeError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof StockUnavailableError || error instanceof PartNotArchivableError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof PartNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  }

  if (getDatabaseErrorCode(error) === PG_UNIQUE_VIOLATION) {
    return NextResponse.json({ ok: false, error: 'Diese Artikelnummer ist bereits vergeben.' }, { status: 409 });
  }
  console.error('Ersatzteile konnten nicht verarbeitet werden.', error);
  return NextResponse.json(
    { ok: false, error: 'Ersatzteile konnten nicht verarbeitet werden.' },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const context = await requireRole(['owner', 'office', 'mechanic']);
    const parts = await getParts(context.tenantId);
    const canViewCosts = context.role !== 'mechanic';
    return NextResponse.json({
      ok: true,
      parts: parts.map((part) => partForRole(part, canViewCosts)),
      canViewCosts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  if (!action || !['createPart', 'updatePart', 'recordStockMovement', 'archivePart'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
  }

  try {
    const context = await requireRole(['owner', 'office', 'mechanic']);
    const { tenantId } = context;
    const canViewCosts = context.role !== 'mechanic';
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      throw new ValidationError('Ungültige JSON-Anfrage.');
    }
    if (!isRecord(value)) throw new ValidationError('Ungültige Anfrage.');

    switch (action) {
      case 'createPart': {
        const openingStockMilli = requiredInteger(value, 'openingStockMilli', 'Der Anfangsbestand');
        if (openingStockMilli < 0) throw new ValidationError('Der Anfangsbestand darf nicht negativ sein.');
        const part = await createPart(tenantId, parsePartInput(value), openingStockMilli);
        return NextResponse.json({ ok: true, part: partForRole(part, canViewCosts) });
      }
      case 'updatePart': {
        const part = await updatePart(tenantId, requiredId(value, 'id'), parsePartInput(value));
        if (!part) return NextResponse.json({ ok: false, error: 'Das Ersatzteil wurde nicht gefunden.' }, { status: 404 });
        return NextResponse.json({ ok: true, part: partForRole(part, canViewCosts) });
      }
      case 'recordStockMovement': {
        const reason = value.reason;
        if (reason !== 'purchase' && reason !== 'correction') {
          throw new ValidationError('Der Bewegungsgrund ist ungültig.');
        }
        const qtyMilli = requiredInteger(value, 'qtyMilli', 'Die Menge');
        if (qtyMilli === 0) throw new ValidationError('Die Bestandsbewegung darf nicht 0 sein.');
        const part = await recordStockMovement(
          tenantId,
          requiredId(value, 'partId'),
          qtyMilli,
          reason,
        );
        return NextResponse.json({ ok: true, part: partForRole(part, canViewCosts) });
      }
      case 'archivePart': {
        const archived = await archivePart(tenantId, requiredId(value, 'id'));
        if (!archived) return NextResponse.json({ ok: false, error: 'Das Ersatzteil wurde nicht gefunden.' }, { status: 404 });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
