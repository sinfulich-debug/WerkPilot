export type Part = {
  id: string;
  sku: string;
  name: string;
  purchasePriceCents: number | null;
  salePriceCents: number;
  minStockMilli: number;
  stockMilli: number;
  reservedMilli: number;
  availableMilli: number;
  archivedAt: string | null;
};

export type PartInput = {
  sku: string;
  name: string;
  purchasePriceCents: number;
  salePriceCents: number;
  minStockMilli: number;
};
