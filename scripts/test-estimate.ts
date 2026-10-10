// Offline tests for the deterministic half of the estimator (no API key needed).
// Run: npx tsx scripts/test-estimate.ts
import assert from "node:assert/strict";
import { findChain, resolveComponents, officialTotals, chainsForPrompt } from "../lib/estimate/chains";
import { enforceRange, postProcess } from "../lib/estimate/estimate";
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
  assert.deepEqual([r.items[0].protein_low_g, r.items[0].protein_high_g], [46, 56]); // 51 ±10%
});

test("ModelOutputSchema accepts a well-formed response", () => {
  assert.ok(ModelOutputSchema.safeParse(base).success);
  assert.ok(!ModelOutputSchema.safeParse({ ...base, items: [{ meal_name: "x" }] }).success);
});

test("prompt table renders every chain", () => {
  const t = chainsForPrompt();
  for (const m of ["Chipotle", "McDonald's", "Nando's", "Raising Cane's"]) assert.ok(t.includes(`### ${m}`));
  console.log(`     (prompt table ~${Math.round(t.length / 4)} tokens est.)`);
});

console.log(`\n${n} tests passed`);
