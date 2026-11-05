// 2026-11-04: the product is 国内-only, so there is exactly one currency. The
// storage/API fields keep their original names (amount_usd, total_usd,
// weekly_budget_usd) — they mean "amount in 元"; renaming them would be an
// IndexedDB migration for no user value. The Currency type stays so a second
// currency could be added later without touching call sites.
export type Currency = "CNY";

export const DEFAULT_CURRENCY: Currency = "CNY";

export const CURRENCIES: Record<Currency, { code: Currency; symbol: string; name: string; minor: string }> = {
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

/** Unit label for the protein-price metric: 分/g (1/100 of the main unit). */
export function cpgUnit(currency: Currency = DEFAULT_CURRENCY): string {
  return `${CURRENCIES[currencyOf(currency)].minor}/g`;
}
