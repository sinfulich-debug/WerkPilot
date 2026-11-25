import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSaveQueue,
  describeImport,
  isInspection,
  patchHeader,
  patchItem,
  runLegacyImport,
  type LegacyStore,
} from './inspection-client';
import { IMPORT_BATCH_SIZE, type Inspection } from './inspections';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ITEM_1 = '33333333-3333-4333-8333-333333333333';
const ITEM_2 = '44444444-4444-4444-8444-444444444444';

function inspection(id: string, items = [ITEM_1, ITEM_2]): Inspection {
  return {
    id,
    customerName: 'Kunde',
    vehicleLabel: 'Golf',
    plate: 'S-AB 1',
    createdAt: '2026-11-18T10:00:00.000Z',
    items: items.map((itemId) => ({ id: itemId, label: 'Bremsanlage', status: 'gruen' as const, note: '', hasPhoto: false })),
  };
}

describe('isInspection', () => {
  it('accepts a well-formed inspection', () => {
    expect(isInspection(inspection(ID_A))).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isInspection(null)).toBe(false);
    expect(isInspection({ ...inspection(ID_A), id: 'pruefung-1' })).toBe(false);
    expect(isInspection({ ...inspection(ID_A), plate: 5 })).toBe(false);
    expect(isInspection({ ...inspection(ID_A), items: 'x' })).toBe(false);
    const badItem = { ...inspection(ID_A), items: [{ id: ITEM_1, label: 'x', status: 'blau', note: '', hasPhoto: false }] };
    expect(isInspection(badItem)).toBe(false);
    const noPhotoFlag = { ...inspection(ID_A), items: [{ id: ITEM_1, label: 'x', status: 'gruen', note: '' }] };
    expect(isInspection(noPhotoFlag)).toBe(false);
  });
});

describe('patchHeader and patchItem', () => {
  it('changes only the chosen inspection and leaves the old list untouched', () => {
    const list = [inspection(ID_A), inspection(ID_B)];
    const next = patchHeader(list, ID_A, { customerName: 'Neu' });
    expect(next[0].customerName).toBe('Neu');
    expect(next[1]).toBe(list[1]);
    expect(list[0].customerName).toBe('Kunde');
  });

  it('changes only the chosen item', () => {
    const list = [inspection(ID_A), inspection(ID_B)];
    const next = patchItem(list, ID_A, ITEM_2, { status: 'rot', note: 'Beläge' });
    expect(next[0].items[0]).toBe(list[0].items[0]);
    expect(next[0].items[1]).toMatchObject({ status: 'rot', note: 'Beläge' });
    expect(next[1]).toBe(list[1]);
    expect(list[0].items[1].status).toBe('gruen');
  });

  it('does not change anything for an unknown id', () => {
    const list = [inspection(ID_A)];
    expect(patchItem(list, ID_B, ITEM_1, { status: 'rot' })).toEqual(list);
  });
});

function fakeStore(initial: unknown[]) {
  let current = initial;
  const writes: unknown[][] = [];
  const store: LegacyStore = {
    read: () => current,
    write: (entries) => {
      current = entries;
      writes.push(entries);
    },
  };
  return { store, writes, remaining: () => current };
}

describe('runLegacyImport', () => {
  const entries = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `alt-${index}` }));

  it('sends the entries in batches and empties the browser copy at the end', async () => {
    const { store, remaining } = fakeStore(entries(IMPORT_BATCH_SIZE * 2 + 1));
    const send = vi.fn(async (batch: unknown[]) => ({ imported: batch.length, skipped: 0 }));

    const result = await runLegacyImport(store, send);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([IMPORT_BATCH_SIZE, IMPORT_BATCH_SIZE, 1]);
    expect(result).toEqual({ imported: IMPORT_BATCH_SIZE * 2 + 1, skipped: 0 });
    expect(remaining()).toEqual([]);
  });

  it('adds up imported and skipped counts', async () => {
    const { store } = fakeStore(entries(IMPORT_BATCH_SIZE + 2));
    const send = vi.fn()
      .mockResolvedValueOnce({ imported: 4, skipped: 1 })
      .mockResolvedValueOnce({ imported: 1, skipped: 1 });
    expect(await runLegacyImport(store, send)).toEqual({ imported: 5, skipped: 2 });
  });

  it('keeps the unsent rest in the browser when a batch fails, so a retry never imports twice', async () => {
    const all = entries(IMPORT_BATCH_SIZE * 2);
    const { store, remaining } = fakeStore(all);
    const send = vi.fn()
      .mockResolvedValueOnce({ imported: IMPORT_BATCH_SIZE, skipped: 0 })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(runLegacyImport(store, send)).rejects.toThrow('offline');
    expect(remaining()).toEqual(all.slice(IMPORT_BATCH_SIZE));

    // second try sends only the rest
    const retry = vi.fn(async (batch: unknown[]) => ({ imported: batch.length, skipped: 0 }));
    await runLegacyImport(store, retry);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0]).toEqual(all.slice(IMPORT_BATCH_SIZE));
    expect(remaining()).toEqual([]);
  });

  it('does nothing when there is no old data', async () => {
    const { store, writes } = fakeStore([]);
    const send = vi.fn();
    expect(await runLegacyImport(store, send)).toEqual({ imported: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('describeImport', () => {
  it('says nothing when nothing happened', () => {
    expect(describeImport({ imported: 0, skipped: 0 })).toBeNull();
  });

  it('uses singular and plural and mentions skipped entries', () => {
    expect(describeImport({ imported: 1, skipped: 0 })).toBe('1 Prüfung aus diesem Browser wurde in die Datenbank übernommen.');
    expect(describeImport({ imported: 3, skipped: 2 })).toBe(
      '3 Prüfungen aus diesem Browser wurden in die Datenbank übernommen. 2 beschädigte Einträge wurden übersprungen.',
    );
  });
});

describe('createSaveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves only the last change of a key after the delay', () => {
    const queue = createSaveQueue(700);
    const first = vi.fn();
    const second = vi.fn();
    queue.schedule('note:1', first);
    vi.advanceTimersByTime(500);
    queue.schedule('note:1', second);
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(queue.pending()).toBe(0);
  });

  it('keeps different keys apart', () => {
    const queue = createSaveQueue(700);
    const a = vi.fn();
    const b = vi.fn();
    queue.schedule('a', a);
    queue.schedule('b', b);
    expect(queue.pending()).toBe(2);
    vi.advanceTimersByTime(700);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('flush sends everything that is waiting right away, exactly once', () => {
    const queue = createSaveQueue(700);
    const a = vi.fn();
    const b = vi.fn();
    queue.schedule('a', a);
    queue.schedule('b', b);
    queue.flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(queue.pending()).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
