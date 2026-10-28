// Offline tests for the deterministic half of the estimator (no API key needed).
// Run: npx tsx scripts/test-estimate.ts
import assert from "node:assert/strict";
import { findChain, resolveComponents, officialTotals, chainsForPrompt } from "../lib/estimate/chains";
import { catalogForPrompt, displayName, findHall, resolveDiningItems, diningTotals, CATALOG, CATALOG_ENTRIES } from "../lib/estimate/dining";
import { enforceRange, postProcess } from "../lib/estimate/estimate";
import { systemBlocks } from "../lib/estimate/prompt";
import { mockModelOutput } from "../lib/estimate/mock";
import { ModelOutputSchema, type ModelOutput } from "../lib/estimate/schema";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  ok -", name);
}

test("findChain resolves aliases and loose names", () => {
  assert.equal(findChain("Chipotle Mexican Grill")?.merchant, "Chipotle");
  assert.equal(findChain("mcdonalds")?.merchant, "McDonald's");
  assert.equal(findChain("麦当劳")?.merchant, "McDonald's");
  assert.equal(findChain("Chick-fil-A #01234")?.merchant, "Chick-fil-A");
  assert.equal(findChain("Jimmy Johns"), findChain("JIMMY JOHN'S"));
  assert.equal(findChain("Some Random Diner"), null);
  assert.equal(findChain(null), null);
});

test("resolveComponents + officialTotals do the arithmetic", () => {
  const c = findChain("chipotle")!;
  const r = resolveComponents(c, [
    { name: "chicken", qty: 1 },
    { name: "White Rice", qty: 1 },
    { name: "Black Beans", qty: 2 },
    { name: "Dragon Sauce", qty: 1 },
  ]);
  assert.equal(r.resolved.length, 3);
  assert.deepEqual(r.unresolved, ["Dragon Sauce"]);
  assert.deepEqual(officialTotals(r), { kcal: 180 + 210 + 260, protein_g: 32 + 4 + 16 });
});

test("kcal-0 price rows are never components", () => {
  const c = findChain("Panda Express")!;
  const r = resolveComponents(c, [{ name: "Plate (1 side + 2 entrees) price only", qty: 1 }]);
  assert.equal(r.resolved.length, 0);
  assert.equal(r.unresolved.length, 1);
});

test("enforceRange widens narrow ranges per confidence and fixes order", () => {
  assert.deepEqual(enforceRange(52, 50, "low"), [38, 64]); // swapped + widened to 50%
  assert.deepEqual(enforceRange(100, 100, "medium"), [85, 115]);
  assert.deepEqual(enforceRange(90, 110, "high"), [90, 110]); // already 20% wide
  assert.deepEqual(enforceRange(-5, 0, "low"), [0, 1]);
  assert.deepEqual(enforceRange(3.6, 4.4, "high"), [3, 5]); // rounding must not collapse to 4–4
  assert.deepEqual(enforceRange(1, 1, "high"), [0, 2]);
});

const base: ModelOutput = {
  error: null,
  merchant: "Chipotle",
  total_usd: 11.5,
  items: [
    {
      meal_name: "鸡肉碗",
      amount_usd: 11.5,
      chain_match: {
        merchant: "Chipotle",
        components: [
          { name: "Chicken", qty: 1 },
          { name: "White Rice", qty: 1 },
          { name: "Black Beans", qty: 1 },
        ],
      },
      dining_match: null,
      kcal_low: 400,
      kcal_high: 700,
      protein_low_g: 30,
      protein_high_g: 60,
      confidence: "medium",
      basis: "model basis",
    },
  ],
  grocery_ingredients: null,
};

test("full chain match -> official_table, high, ±10%", () => {
  const r = postProcess(base, { type: "text", content: "Chipotle 鸡肉碗 $11.5" });
  assert.equal(r.ok, true);
  if (!r.ok || r.kind !== "meal") throw new Error("bad kind");
  const it = r.items[0];
  assert.equal(it.source, "official_table");
  assert.equal(it.confidence, "high");
  assert.deepEqual([it.kcal_low, it.kcal_high], [468, 572]); // 520 ±10%
  assert.deepEqual([it.protein_low_g, it.protein_high_g], [40, 48]); // 44 ±10%
  assert.equal(it.amount_usd, 11.5);
  assert.equal(r.merchant, "Chipotle");
  assert.match(it.basis, /官方营养表/);
  const relWidth = (it.protein_high_g - it.protein_low_g) / ((it.protein_high_g + it.protein_low_g) / 2);
  assert.ok(relWidth <= 0.3, "high-confidence width must be <= 30%");
});

test("unresolved component -> falls back to model range, capped at medium, not official", () => {
  const out: ModelOutput = JSON.parse(JSON.stringify(base));
  out.items[0].chain_match!.components.push({ name: "Secret Sauce", qty: 1 });
  out.items[0].confidence = "high";
  const r = postProcess(out, { type: "text", content: "Chipotle 鸡肉碗 $11.5" });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items[0].source, "text_estimate");
  assert.equal(r.items[0].confidence, "medium");
  assert.match(r.items[0].basis, /未能匹配/);
});

test("photo without chain match is forced to low confidence and visual source", () => {
  const out: ModelOutput = JSON.parse(JSON.stringify(base));
  out.items[0].chain_match = null;
  out.items[0].confidence = "high";
  out.items[0].protein_low_g = 50;
  out.items[0].protein_high_g = 52;
  const r = postProcess(out, { type: "photo", content: "x".repeat(200) });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items[0].confidence, "low");
  assert.equal(r.items[0].source, "visual_estimate");
  const w = (r.items[0].protein_high_g - r.items[0].protein_low_g) / 51;
  assert.ok(w >= 0.49, `low-confidence width widened, got ${w}`);
});

test("text input with no digits never reports an amount", () => {
  const r = postProcess(base, { type: "text", content: "Chipotle 鸡肉碗" });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items[0].amount_usd, null);
  assert.equal(r.total_usd, null);
});

test("grocery -> ingredients only, no items", () => {
  const r = postProcess(mockModelOutput({ type: "grocery", content: "x".repeat(200) }), {
    type: "grocery",
    content: "x".repeat(200),
  });
  assert.equal(r.ok && r.kind === "grocery" && r.ingredients.length, 5);
});

test("model error with no items -> ok:false", () => {
  const r = postProcess(
    { error: "照片太模糊", merchant: null, total_usd: null, items: [], grocery_ingredients: null },
    { type: "photo", content: "x".repeat(200) },
  );
  assert.deepEqual(r, { ok: false, error: "照片太模糊", retryable: true });
});

test("mock text pipeline end to end", () => {
  const input = { type: "text" as const, content: "Chipotle 鸡肉碗 $11.5" };
  const r = postProcess(mockModelOutput(input), input);
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items[0].source, "official_table");
  assert.equal(r.items[0].amount_usd, 11.5);
  assert.deepEqual([r.items[0].protein_low_g, r.items[0].protein_high_g], [45, 55]); // 50 ±10% (salsa protein is 0 per the official calculator)
});

test("ModelOutputSchema accepts a well-formed response", () => {
  assert.ok(ModelOutputSchema.safeParse(base).success);
  assert.ok(!ModelOutputSchema.safeParse({ ...base, items: [{ meal_name: "x" }] }).success);
});

test("unverified chain match -> reference_table, medium, ±15%, never 官方", () => {
  const out: ModelOutput = JSON.parse(JSON.stringify(base));
  out.merchant = "Panda Express";
  out.items[0].chain_match = { merchant: "Panda Express", components: [{ name: "Orange Chicken", qty: 1 }] };
  const r = postProcess(out, { type: "text", content: "Panda Express orange chicken $9" });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  const it = r.items[0];
  assert.equal(findChain("Panda Express")?.data_status, "unverified");
  assert.equal(it.source, "reference_table");
  assert.equal(it.confidence, "medium");
  assert.match(it.basis, /参考营养表/);
  assert.doesNotMatch(it.basis, /官方/);
  const oc = findChain("Panda Express")!.items.find((i) => i.name === "Orange Chicken")!;
  assert.deepEqual([it.protein_low_g, it.protein_high_g], enforceRange(oc.protein_g * 0.85, oc.protein_g * 1.15, "medium"));
});

test("spot-checked chain is also not 官方 (partial)", () => {
  assert.equal(findChain("Chick-fil-A")?.data_status, "partial");
  assert.equal(findChain("chipotle")?.data_status, "official");
  const t = chainsForPrompt();
  assert.ok(t.includes("### Panda Express [未核实]"));
  assert.ok(t.includes("### Chipotle (aliases"));
});

test("findHall resolves slugs, short names and aliases", () => {
  assert.equal(findHall("baker-dining-commons")?.short, "Baker");
  assert.equal(findHall("Baker")?.slug, "baker-dining-commons");
  assert.equal(findHall("Bartlett Dining Commons")?.short, "Bartlett");
  assert.equal(findHall("woodlawn")?.short, "Woodlawn");
  assert.equal(findHall("Hutchinson Commons"), null);
  assert.equal(findHall(undefined), null);
});

test("catalog: duplicate names get a portion suffix; same name+portion collapses to a range", () => {
  const oats = CATALOG.filter((i) => i.name === "Oatmeal");
  assert.ok(oats.length >= 2);
  assert.equal(displayName(oats[0]), `Oatmeal (${oats[0].portion})`);
  const r = resolveDiningItems([
    { name: displayName(oats[1]), qty: 1 },
    { name: "oatmeal", qty: 2 }, // bare name -> first row
    { name: "Scrambled Eggs (1/2 cup)", qty: 0.5 }, // one portion only -> display is bare; suffix tolerated
    { name: "Turkey Bacon", qty: 1 }, // not in catalog
    { name: "Bacon", qty: 99 }, // qty clamped
  ]);
  assert.equal(r.resolved[0].entry.variants[0].id, oats[1].id);
  assert.equal(r.resolved[1].entry.variants[0].id, oats[0].id);
  assert.deepEqual(r.unresolved, ["Turkey Bacon"]);
  assert.equal(r.resolved[3].qty, 6);
  // two Scrambled Eggs recipes share the 1/2 cup portion (210/14 checked on the site, 100/10 elsewhere)
  assert.deepEqual(r.resolved[2].entry.kcal, [100, 210]);
  assert.deepEqual(r.resolved[2].entry.protein_g, [10, 14]);
  assert.equal(r.resolved[2].entry.variants.length, 2);
  assert.deepEqual(r.resolved[3].entry.kcal, [150, 150]); // Bacon: single recipe -> point
  const ents = CATALOG_ENTRIES.filter((e) => e.name === "Scrambled Eggs");
  assert.equal(ents.length, 1);
  assert.equal(ents[0].display, "Scrambled Eggs");
});

test("dining match -> dining_menu source, medium, ±20% over official per-portion rows", () => {
  const out: ModelOutput = JSON.parse(JSON.stringify(base));
  out.merchant = "Baker";
  out.items[0] = {
    ...out.items[0],
    chain_match: null,
    dining_match: { hall: "Baker", items: [{ name: "Scrambled Eggs", qty: 2 }, { name: "Bacon", qty: 1 }] },
    confidence: "high",
  };
  const r = postProcess(out, { type: "photo", content: "x".repeat(200), dining_hall: "baker-dining-commons" });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  const it = r.items[0];
  assert.equal(it.source, "dining_menu");
  assert.equal(it.confidence, "medium");
  assert.equal(it.merchant, "Baker");
  const t = diningTotals(resolveDiningItems(out.items[0].dining_match!.items));
  assert.deepEqual(t, { kcal: [100 * 2 + 150, 210 * 2 + 150], protein_g: [10 * 2 + 11, 14 * 2 + 11] });
  assert.deepEqual([it.protein_low_g, it.protein_high_g], enforceRange(t.protein_g[0] * 0.8, t.protein_g[1] * 1.2, "medium"));
  assert.match(it.basis, /Baker 食堂菜品库/);
  assert.deepEqual(it.matched_components, ["Scrambled Eggs×2", "Bacon"]);
});

test("dining match with an unknown item falls back to the model range (photo -> low)", () => {
  const out: ModelOutput = JSON.parse(JSON.stringify(base));
  out.items[0] = {
    ...out.items[0],
    chain_match: null,
    dining_match: { hall: "Baker", items: [{ name: "Mystery Stew", qty: 1 }] },
    basis: "目测",
  };
  const r = postProcess(out, { type: "photo", content: "x".repeat(200), dining_hall: "Baker" });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items[0].source, "visual_estimate");
  assert.equal(r.items[0].confidence, "low");
  assert.match(r.items[0].basis, /菜品库里没有/);
});

test("dining_match is ignored without a dining_hall on the request", () => {
  const out: ModelOutput = JSON.parse(JSON.stringify(base));
  out.items[0] = { ...out.items[0], chain_match: null, dining_match: { hall: "Baker", items: [{ name: "Scrambled Eggs", qty: 2 }] } };
  const r = postProcess(out, { type: "photo", content: "x".repeat(200) });
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items[0].source, "visual_estimate");
  assert.equal(r.items[0].confidence, "low");
});

test("system prompt adds the catalog block only for dining requests", () => {
  assert.equal(systemBlocks({ type: "text", content: "x" }).length, 1);
  assert.equal(systemBlocks({ type: "text", content: "x", dining_hall: "Baker" }).length, 2);
  assert.equal(systemBlocks({ type: "receipt", content: "x".repeat(200), dining_hall: "Baker" }).length, 1);
  const c = catalogForPrompt();
  assert.ok(c.includes("- Scrambled Eggs | 1/2 cup | 100-210 kcal | 10-14 g"));
  assert.ok(c.includes("- Oatmeal (1 ladle-4oz) | 1 ladle-4oz | 90 kcal | 3 g"));
  assert.ok(c.includes("- Bacon | 3 slice | 150 kcal | 11 g"));
  console.log(`     (catalog block ~${Math.round(c.length / 4)} tokens est., ${CATALOG_ENTRIES.length} entries from ${CATALOG.length} rows)`);
});

test("mock dining photo pipeline end to end", () => {
  const input = { type: "photo" as const, content: "x".repeat(200), dining_hall: "baker-dining-commons" };
  const r = postProcess(mockModelOutput(input), input);
  if (!r.ok || r.kind !== "meal") throw new Error("bad");
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((i) => i.source === "dining_menu" && i.confidence === "medium"));
});

test("prompt table renders every chain", () => {
  const t = chainsForPrompt();
  for (const m of ["Chipotle", "McDonald's", "Nando's", "Raising Cane's"]) assert.ok(t.includes(`### ${m}`));
  console.log(`     (prompt table ~${Math.round(t.length / 4)} tokens est.)`);
});

console.log(`\n${n} tests passed`);
