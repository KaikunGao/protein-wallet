// 内置起步清单 (2026-11-04): a built-in place so the home list is not empty before the
// first scan. Basic supermarket items with reference prices; it lives in the user's own
// `menus` store like any saved place, so it can be renamed or deleted (and stays deleted).
import starterData from "../data/starter.json";
import type { MenuItem, SavedMenu } from "./menu-rank";

export const STARTER_ID = "starter";
const SPREAD = starterData._meta.spread;

function range(n: number): [number, number] {
  let lo = Math.round(n * (1 - SPREAD));
  let hi = Math.round(n * (1 + SPREAD));
  if (lo === hi) hi = lo + 1; // never a point value
  if (lo < 0) lo = 0;
  return [lo, hi];
}

export function starterMenu(ts: number): SavedMenu {
  const items: MenuItem[] = starterData.items.map((it, i) => {
    const [pl, ph] = range(it.protein_g);
    const [kl, kh] = range(it.kcal);
    return {
      id: String(i),
      name: it.name,
      price: it.price,
      kcal_low: kl,
      kcal_high: kh,
      protein_low_g: pl,
      protein_high_g: ph,
      confidence: "medium",
      basis: `起步清单:蛋白按食材表(${it.from});价格是参考价(${it.price_note}),以你那里的实际价格为准`,
      source: "ingredient_table",
    };
  });
  return { id: STARTER_ID, name: starterData._meta.name, ts, items, starter: true };
}
