// 拍菜单做决策 (PRD F0-2): types shared by the server parser and the client, plus the
// ranking itself. Pure and dependency-free so the client bundle never pulls in the tables
// or the SDK. The model reads the menu; THIS code decides the order, by one visible key.
import type { EstimateItem } from "./estimate/schema";
import type { Confidence, Meal, Source } from "./types";

export interface MenuItem {
  id: string;
  name: string;
  price: number | null; // 元, only when the menu shows it
  kcal_low: number;
  kcal_high: number;
  protein_low_g: number;
  protein_high_g: number;
  confidence: Confidence;
  basis: string;
  source: Source;
  components?: string[]; // "鸡腿×1" … when the protein came from the ingredient table
  side?: boolean; // protein comes only from staples / vegetables: listed, never ranked
}

export type MenuResponse =
  | { ok: true; merchant: string | null; items: MenuItem[] }
  | { ok: false; error: string; retryable: boolean };

export interface RankedDish extends MenuItem {
  proteinMid: number;
  cpg: number; // 分/g at the protein midpoint
  cpgLow: number; // best case: price over the high end of the protein range
  cpgHigh: number; // worst case: price over the low end
  over: boolean; // costs more than today's spendable money
}

/**
 * A scanned menu kept as a place the user goes to (每日清单, 2026-11-04). Menus rarely
 * change, so the scan is paid once per place; afterwards the home page ranks these dishes
 * every day without a photo.
 */
export interface SavedMenu {
  id: string;
  name: string; // "二食堂 3 号窗口", "老王快餐" — the shop name read off the menu, or one the user typed
  ts: number; // last scanned / edited
  items: MenuItem[];
  shared_ts?: number; // imported from a share link: when the sharer scanned it
  starter?: boolean; // the built-in starter list (reference prices)
}

function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

/**
 * The record to store for a freshly parsed menu: scanning the same place again replaces
 * its dishes (prices change) instead of piling up duplicates.
 */
export function upsertMenu(existing: SavedMenu[], name: string, items: MenuItem[], newId: string, ts: number): SavedMenu {
  const clean = name.trim() || "未命名菜单";
  const same = existing.find((m) => normName(m.name) === normName(clean));
  return { id: same?.id ?? newId, name: clean, ts, items };
}

/** A dish picked straight from a saved menu (no confirm card) as a meal record. */
export function mealFromDish(d: MenuItem, venue: string | null, id: string, ts: number, menuId?: string | null): Meal {
  return {
    ...(menuId ? { menu_id: menuId } : {}),
    id,
    ts,
    kind: "meal",
    input_type: "menu",
    meal_name: d.name,
    merchant: venue,
    amount_usd: d.price,
    kcal_low: d.kcal_low,
    kcal_high: d.kcal_high,
    protein_low_g: d.protein_low_g,
    protein_high_g: d.protein_high_g,
    confidence: d.confidence,
    basis: d.basis,
    source: d.source,
    user_corrected: false,
    portion_factor: 1,
  };
}

export type MenuSort = "cpg" | "protein";
export const MENU_TOP = 3;
const MIN_PROTEIN_MID = 2; // under 2 g (drinks, plain sides) a dish is listed but not ranked

/**
 * Rank a parsed menu. A dish is ranked only when the menu showed its price and it
 * carries protein from a protein source; plain staples and vegetables (`side`) are left
 * out because 1 元 of rice "wins" on 分/g without being what a 增肌 user is looking for.
 * Everything unranked is returned in `unranked` so nothing silently vanishes.
 */
export function rankMenu(
  items: MenuItem[],
  sort: MenuSort = "cpg",
  spendable: number | null = null,
): { ranked: RankedDish[]; unranked: MenuItem[] } {
  const ranked: RankedDish[] = [];
  const unranked: MenuItem[] = [];
  for (const it of items) {
    const proteinMid = (it.protein_low_g + it.protein_high_g) / 2;
    if (it.price == null || it.price <= 0 || proteinMid < MIN_PROTEIN_MID || it.side) {
      unranked.push(it);
      continue;
    }
    ranked.push({
      ...it,
      proteinMid,
      cpg: (it.price * 100) / proteinMid,
      cpgLow: (it.price * 100) / Math.max(it.protein_high_g, 0.1),
      cpgHigh: (it.price * 100) / Math.max(it.protein_low_g, 0.1),
      over: spendable != null && it.price > spendable,
    });
  }
  ranked.sort((a, b) =>
    sort === "cpg" ? a.cpg - b.cpg || b.proteinMid - a.proteinMid : b.proteinMid - a.proteinMid || a.cpg - b.cpg,
  );
  return { ranked, unranked };
}

/** A picked dish as an estimate item, so it can go through the normal confirm card. */
export function toEstimateItem(d: MenuItem, merchant: string | null): EstimateItem {
  return {
    meal_name: d.name,
    merchant,
    amount_usd: d.price,
    kcal_low: d.kcal_low,
    kcal_high: d.kcal_high,
    protein_low_g: d.protein_low_g,
    protein_high_g: d.protein_high_g,
    confidence: d.confidence,
    basis: d.basis,
    source: d.source,
    matched_components: d.components,
    // A menu shows one standard portion; the chips still let the user say "ate half".
    portion: { unit: "份", assumed: 1, unsure: false },
  };
}
