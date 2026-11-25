import { describe, expect, it } from 'vitest';
import { buildWorkOrderLink, parseWorkOrderPrefill } from './work-order-prefill';

const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vehicleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('buildWorkOrderLink', () => {
  it('links to the estimates tab with customer, vehicle and service', () => {
    const link = buildWorkOrderLink({ customerId, vehicleId, reason: 'Hauptuntersuchung / TÜV' });
    expect(link).not.toBeNull();
    const url = new URL(link as string, 'http://localhost');
    expect(url.pathname).toBe('/werkstatt');
    expect(url.searchParams.get('tab')).toBe('estimates');
    expect(url.searchParams.get('customerId')).toBe(customerId);
    expect(url.searchParams.get('vehicleId')).toBe(vehicleId);
    expect(url.searchParams.get('service')).toBe('Hauptuntersuchung / TÜV');
  });

  it('gives no link when the appointment has no customer or no vehicle record', () => {
    expect(buildWorkOrderLink({ customerId: undefined, vehicleId, reason: 'HU' })).toBeNull();
    expect(buildWorkOrderLink({ customerId, vehicleId: undefined, reason: 'HU' })).toBeNull();
  });
});

describe('parseWorkOrderPrefill', () => {
  it('reads a link built from an appointment, including special characters', () => {
    const link = buildWorkOrderLink({ customerId, vehicleId, reason: 'Ölwechsel & Bremsen (vorne)' }) as string;
    const parsed = parseWorkOrderPrefill(new URL(link, 'http://localhost').searchParams);
    expect(parsed).toEqual({ customerId, vehicleId, service: 'Ölwechsel & Bremsen (vorne)' });
  });

  it('ignores other tabs and invalid or missing ids', () => {
    const make = (query: string) => new URLSearchParams(query);
    expect(parseWorkOrderPrefill(make(''))).toBeNull();
    expect(parseWorkOrderPrefill(make(`tab=board&customerId=${customerId}&vehicleId=${vehicleId}`))).toBeNull();
    expect(parseWorkOrderPrefill(make(`tab=estimates&customerId=nope&vehicleId=${vehicleId}`))).toBeNull();
    expect(parseWorkOrderPrefill(make(`tab=estimates&customerId=${customerId}`))).toBeNull();
  });

  it('shortens an over-long service text', () => {
    const params = new URLSearchParams({ tab: 'estimates', customerId, vehicleId, service: 'x'.repeat(500) });
    expect(parseWorkOrderPrefill(params)?.service).toHaveLength(200);
  });
});
