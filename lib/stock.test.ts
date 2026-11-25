import { describe, expect, it } from 'vitest';
import {
  assertStockAdjustmentAllowed,
  assertStockAvailable,
  StockUnavailableError,
} from './stock';

describe('stock availability', () => {
  it('reserves only stock not already reserved', () => {
    expect(() => assertStockAvailable('Ölfilter', 5_000, 2_000, 3_000)).not.toThrow();
    expect(() => assertStockAvailable('Ölfilter', 5_000, 2_000, 3_001))
      .toThrow(StockUnavailableError);
  });

  it('prevents corrections from consuming reserved stock', () => {
    expect(() => assertStockAdjustmentAllowed('Ölfilter', 5_000, 3_000, -2_000)).not.toThrow();
    expect(() => assertStockAdjustmentAllowed('Ölfilter', 5_000, 3_000, -2_001))
      .toThrow(StockUnavailableError);
  });
});
