export class StockUnavailableError extends Error {
  constructor(partName: string) {
    super(`Für „${partName}“ ist nicht genügend verfügbarer Bestand vorhanden.`);
    this.name = 'StockUnavailableError';
  }
}

export function assertStockAvailable(
  partName: string,
  onHandMilli: number,
  reservedMilli: number,
  additionalDemandMilli = 0,
): void {
  if (onHandMilli - reservedMilli - additionalDemandMilli < 0) {
    throw new StockUnavailableError(partName);
  }
}

export function assertStockAdjustmentAllowed(
  partName: string,
  onHandMilli: number,
  reservedMilli: number,
  adjustmentMilli: number,
): void {
  if (onHandMilli + adjustmentMilli < reservedMilli) {
    throw new StockUnavailableError(partName);
  }
}
