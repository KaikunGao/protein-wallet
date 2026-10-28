// Currency the user records in. One setting, no conversion: a record is in
// whatever currency the user chose when they saved it.
// DECISION: the storage/API fields keep their original names (amount_usd,
// total_usd, weekly_budget_usd) — they now mean "amount in the user's
// currency". Renaming them would be an IndexedDB migration for no user value.
export type Currency = "USD" | "CNY";

export const DEFAULT_CURRENCY: Currency = "USD";

export const CURRENCIES: Record<Currency, { code: Currency; symbol: string; name: string; minor: string }> = {
  USD: { code: "USD", symbol: "$", name: "美元", minor: "¢" },
  CNY: { code: "CNY", symbol: "¥", name: "人民币", minor: "分" },
};

export function currencyOf(c: Currency | null | undefined): Currency {
  return c && c in CURRENCIES ? c : DEFAULT_CURRENCY;
}

export function fmtMoney(n: number, currency: Currency = DEFAULT_CURRENCY): string {
  const sym = CURRENCIES[currencyOf(currency)].symbol;
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? `${sym}${v}` : `${sym}${v.toFixed(2)}`;
}

/** Unit label for the protein-price metric: ¢/g for USD, 分/g for CNY (both are 1/100 of the main unit). */
export function cpgUnit(currency: Currency = DEFAULT_CURRENCY): string {
  return `${CURRENCIES[currencyOf(currency)].minor}/g`;
}
