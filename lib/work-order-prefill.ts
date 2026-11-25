import type { Appointment } from './appointments';

/** Prefill for the "Kalkulation & Angebote" form on /werkstatt, taken from an appointment. */
export type WorkOrderPrefill = {
  customerId: string;
  vehicleId: string;
  service: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_SERVICE_LENGTH = 200;

/**
 * Link that opens the work-order form filled in from an appointment, or null when the appointment
 * is not linked to a customer and a vehicle (a work order needs both).
 */
export function buildWorkOrderLink(
  appointment: Pick<Appointment, 'customerId' | 'vehicleId' | 'reason'>,
): string | null {
  if (!appointment.customerId || !appointment.vehicleId) return null;
  const params = new URLSearchParams({
    tab: 'estimates',
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    service: appointment.reason.trim().slice(0, MAX_SERVICE_LENGTH),
  });
  return `/werkstatt?${params.toString()}`;
}

/** Reads and validates the prefill from the query string; anything suspicious means no prefill. */
export function parseWorkOrderPrefill(params: Pick<URLSearchParams, 'get'>): WorkOrderPrefill | null {
  if (params.get('tab') !== 'estimates') return null;
  const customerId = params.get('customerId');
  const vehicleId = params.get('vehicleId');
  if (!customerId || !vehicleId || !UUID_PATTERN.test(customerId) || !UUID_PATTERN.test(vehicleId)) return null;
  const service = (params.get('service') ?? '').trim().slice(0, MAX_SERVICE_LENGTH);
  return { customerId, vehicleId, service };
}
