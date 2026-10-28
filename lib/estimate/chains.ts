import chainsData from "../../data/chains.json";

export interface ChainItem {
  name: string;
  kcal: number;
  protein_g: number;
  price_hint: number | null;
}
export type ChainDataStatus = "official" | "partial" | "unverified";
export interface Chain {
  merchant: string;
  // official = every row checked against the chain's site; partial = spot-checked;
  // unverified = entered from memory. Only "official" may be shown as 官方数据.
  data_status: ChainDataStatus;
  aliases: string[];
  source_url: string;
  items: ChainItem[];
}

export const CHAINS: Chain[] = chainsData.chains as Chain[];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9一-鿿'&#\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a merchant string (or alias) to a chain, or null. */
export function findChain(name: string | null | undefined): Chain | null {
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  for (const c of CHAINS) {
    const names = [c.merchant, ...c.aliases].map(norm);
    if (names.some((a) => a === n)) return c;
  }
  // loose match: input contains an alias as a whole token sequence (e.g. "Chipotle - 53rd St")
  for (const c of CHAINS) {
    const names = [c.merchant, ...c.aliases].map(norm).filter((a) => a.length >= 4);
    if (names.some((a) => n.includes(a))) return c;
  }
  return null;
}

export function findItem(chain: Chain, name: string): ChainItem | null {
  const n = norm(name);
  return chain.items.find((i) => norm(i.name) === n) ?? null;
}

export interface Resolved {
  resolved: { item: ChainItem; qty: number }[];
  unresolved: string[];
}

export function resolveComponents(
  chain: Chain,
  components: { name: string; qty: number }[],
): Resolved {
  const out: Resolved = { resolved: [], unresolved: [] };
  for (const c of components) {
    const item = findItem(chain, c.name);
    const qty = Number.isFinite(c.qty) && c.qty > 0 ? c.qty : 1;
    // kcal 0 rows are price references only, never nutrition components
    if (item && item.kcal !== 0) out.resolved.push({ item, qty });
    else out.unresolved.push(c.name);
  }
  return out;
}

export function officialTotals(r: Resolved): { kcal: number; protein_g: number } {
  return r.resolved.reduce(
    (acc, { item, qty }) => ({
      kcal: acc.kcal + item.kcal * qty,
      protein_g: acc.protein_g + item.protein_g * qty,
    }),
    { kcal: 0, protein_g: 0 },
  );
}

/** Compact text rendering of the table for the system prompt. */
export function chainsForPrompt(): string {
  const lines: string[] = [];
  for (const c of CHAINS) {
    const tag = c.data_status === "official" ? "" : " [未核实]";
    lines.push(`### ${c.merchant}${tag} (aliases: ${c.aliases.join(", ")})`);
    for (const i of c.items) {
      const price = i.price_hint != null ? ` | $${i.price_hint}` : "";
      lines.push(`- ${i.name} | ${i.kcal} kcal | ${i.protein_g} g${price}`);
    }
  }
  return lines.join("\n");
}
