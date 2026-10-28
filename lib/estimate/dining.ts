// Tier 2 of the three-tier estimate: the campus dining-hall item catalog with
// official per-portion nutrition (Dine On Campus). The model only decides which
// catalog items are on the plate and how many portions; the arithmetic is done here.
//
// DECISION (2026-10-28): the catalog is a snapshot in the repo
// (data/dining/uchicago/catalog.json), not a live fetch, and it is an item
// catalog rather than per-day menus:
//  - apiv4.dineoncampus.com sits behind Cloudflare bot protection and has no
//    CORS for other origins, so neither the Vercel server nor the PWA can call it.
//  - Per-item nutrition read through the site is accurate (spot-checked against
//    the page's own nutrition panels), but the day/station composition the API
//    returns without the site's own request signature is scrambled. We do not
//    work around that; we ship the items and let the model pick from them.
// Refresh = re-run the snapshot by hand (see data/dining/README.md), the same
// way chains.json is refreshed.
import hallsData from "../../data/dining/uchicago/halls.json";
import catalogData from "../../data/dining/uchicago/catalog.json";

export interface DiningHall {
  slug: string;
  name: string; // official name, e.g. "Baker Dining Commons"
  short: string; // what students say, e.g. "Baker"
  aliases: string[];
  location_id: string;
}

export interface DiningItem {
  id: string; // Dine On Campus recipe number (mrnFull)
  name: string;
  portion: string; // official serving, e.g. "1/2 cup", "3 oz"
  kcal: number;
  protein_g: number;
}

interface CatalogFile {
  _meta: Record<string, unknown>;
  items: DiningItem[];
}

export const HALLS: DiningHall[] = (hallsData as { halls: DiningHall[] }).halls;
export const CATALOG: DiningItem[] = (catalogData as CatalogFile).items;
export const CATALOG_META = (catalogData as CatalogFile)._meta;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9一-鿿'&%/\-\s()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a hall slug / name / alias ("Baker", "baker-dining-commons") to a hall, or null. */
export function findHall(name: string | null | undefined): DiningHall | null {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  for (const h of HALLS) {
    const names = [h.slug, h.name, h.short, ...h.aliases].map(norm);
    if (names.some((a) => a === n)) return h;
  }
  for (const h of HALLS) {
    const names = [h.name, h.short, ...h.aliases].map(norm).filter((a) => a.length >= 4);
    if (names.some((a) => n.includes(a))) return h;
  }
  return null;
}

// Several catalog rows share a name with different portions (Oatmeal 1 ladle vs
// 4 oz): the prompt shows those as "Name (portion)" so the model can pick one; a
// bare name resolves to the first row. Rows that share name AND portion are
// different recipes (Scrambled Eggs 1/2 cup: 210 kcal at one hall, 100 at another)
// and nobody can tell them apart on a plate, so they collapse into ONE entry whose
// nutrition is a range spanning all variants. The output is a range anyway.
export interface CatalogEntry {
  display: string; // what the prompt shows and what dining_match.items[].name must equal
  name: string;
  portion: string;
  kcal: [number, number];
  protein_g: [number, number];
  variants: DiningItem[];
}

const nameCount = new Map<string, number>();
for (const it of CATALOG) {
  const k = norm(it.name);
  const p = norm(it.portion);
  const key = `${k}|${p}`;
  if (!nameCount.has(key)) nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  nameCount.set(key, 1);
}

export function displayName(it: DiningItem): string {
  return (nameCount.get(norm(it.name)) ?? 0) > 1 ? `${it.name.trim()} (${it.portion})` : it.name.trim();
}

const ENTRIES: CatalogEntry[] = [];
const byDisplay = new Map<string, CatalogEntry>();
const byName = new Map<string, CatalogEntry>();
for (const it of CATALOG) {
  const display = displayName(it);
  let e = byDisplay.get(norm(display));
  if (!e) {
    e = { display, name: it.name.trim(), portion: it.portion, kcal: [it.kcal, it.kcal], protein_g: [it.protein_g, it.protein_g], variants: [] };
    ENTRIES.push(e);
    byDisplay.set(norm(display), e);
    if (!byName.has(norm(it.name))) byName.set(norm(it.name), e);
  }
  e.variants.push(it);
  e.kcal = [Math.min(e.kcal[0], it.kcal), Math.max(e.kcal[1], it.kcal)];
  e.protein_g = [Math.min(e.protein_g[0], it.protein_g), Math.max(e.protein_g[1], it.protein_g)];
}
export const CATALOG_ENTRIES: CatalogEntry[] = ENTRIES;

let promptCache: string | null = null;
/** Catalog text for the prompt (stable across requests, so it is prompt-cached). */
export function catalogForPrompt(): string {
  if (promptCache) return promptCache;
  const lines: string[] = [];
  lines.push("## 食堂菜品库(芝加哥大学 Baker / Bartlett / Woodlawn / Cathey 食堂,Dine On Campus 官方每份营养)");
  lines.push(
    "这是本学期食堂出现过的菜品,不保证当天都有。每行:菜名 | 官方一份的份量 | kcal | 蛋白质 g(同名同份量但做法不同的菜给的是范围)。dining_match.items[].name 必须是菜名原文(含括号里的份量),qty 是份数(可用小数)。",
  );
  const r = (x: [number, number]) => (x[0] === x[1] ? `${x[0]}` : `${x[0]}-${x[1]}`);
  for (const e of ENTRIES) {
    lines.push(`- ${e.display} | ${e.portion || "1 serving"} | ${r(e.kcal)} kcal | ${r(e.protein_g)} g`);
  }
  promptCache = lines.join("\n");
  return promptCache;
}

export interface DiningResolved {
  resolved: { entry: CatalogEntry; qty: number }[];
  unresolved: string[];
}

const MIN_QTY = 0.25;
const MAX_QTY = 6;

/** Match the model's dining_match items against the catalog by display name, then bare name. */
export function resolveDiningItems(components: { name: string; qty: number }[]): DiningResolved {
  const out: DiningResolved = { resolved: [], unresolved: [] };
  for (const c of components) {
    const n = norm(c.name);
    // display name, then bare name, then bare name with a "(portion)" suffix the model may have added
    const bare = n.replace(/\s*\([^)]*\)\s*$/, "");
    const entry = byDisplay.get(n) ?? byName.get(n) ?? byDisplay.get(bare) ?? byName.get(bare) ?? null;
    if (!entry) {
      out.unresolved.push(c.name);
      continue;
    }
    const qty = Number.isFinite(c.qty) && c.qty > 0 ? Math.min(MAX_QTY, Math.max(MIN_QTY, c.qty)) : 1;
    out.resolved.push({ entry, qty });
  }
  return out;
}

/** Sum of the matched entries; low/high differ only when an entry spans several recipes. */
export function diningTotals(r: DiningResolved): { kcal: [number, number]; protein_g: [number, number] } {
  return r.resolved.reduce<{ kcal: [number, number]; protein_g: [number, number] }>(
    (acc, { entry, qty }) => ({
      kcal: [acc.kcal[0] + entry.kcal[0] * qty, acc.kcal[1] + entry.kcal[1] * qty],
      protein_g: [acc.protein_g[0] + entry.protein_g[0] * qty, acc.protein_g[1] + entry.protein_g[1] * qty],
    }),
    { kcal: [0, 0], protein_g: [0, 0] },
  );
}
