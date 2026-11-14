// Offline tests for 拍菜单: table lookup, street recipes, post-processing guards, ranking.
// Run: npx tsx scripts/test-menu.ts
import assert from "node:assert/strict";
import {
  INGREDIENTS, RECIPES, findIngredient, findRecipe, guessSources, mockMenuOutput, menuSystemBlocks,
  postProcessMenu, recipeSources, resolveSources, sourceTotals, MenuModelSchema, type MenuModelOutput,
} from "../lib/estimate/menu";
import { rankMenu, toEstimateItem } from "../lib/menu-rank";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n++;
  console.log("  ok -", name);
}

test("tables are consistent: every recipe component exists, no duplicate names", () => {
  const names = INGREDIENTS.map((i) => i.name);
  assert.equal(new Set(names).size, names.length);
  for (const r of RECIPES) for (const b of r.base) assert.ok(findIngredient(b.name), `${r.name}: ${b.name}`);
  assert.ok(INGREDIENTS.every((i) => i.protein_g > 0 && i.kcal > 0));
});

test("findIngredient: exact name or alias only", () => {
  assert.equal(findIngredient("鸡蛋")?.protein_g, 6.5);
  assert.equal(findIngredient("茶叶蛋")?.name, "鸡蛋");
  assert.equal(findIngredient(" 琵琶腿 ")?.name, "鸡腿");
  assert.equal(findIngredient("龙虾"), null);
  assert.equal(findIngredient(""), null);
});

test("street recipes: base plus add-ons named in the dish", () => {
  const r = findRecipe("煎饼果子加蛋加肠")!;
  assert.equal(r.name, "煎饼果子");
  // 煎饼面糊 5 + 鸡蛋 2×6.5 + 薄脆 2 + 火腿肠 7 = 27（火腿肠 2026-11-13 核对后由 5 改为 7）
  assert.equal(sourceTotals(resolveSources(recipeSources("煎饼果子加蛋加肠", r))).protein_g, 27);
  // 双蛋 = one more egg on top of the base one: 5 + 13 + 2 = 20
  assert.equal(sourceTotals(resolveSources(recipeSources("杂粮煎饼双蛋", findRecipe("杂粮煎饼双蛋")!))).protein_g, 20);
  // longest alias wins: 黄焖鸡米饭, not a shorter match
  assert.equal(findRecipe("黄焖鸡米饭(大份)")?.name, "黄焖鸡米饭");
  assert.equal(findRecipe("清炒时蔬"), null);
});

test("guessSources: longest alias first, no overlaps, nothing for unknown dishes", () => {
  assert.deepEqual(guessSources("宫保鸡丁盖饭").map((s) => s.name), ["鸡胸肉", "米饭"]);
  assert.deepEqual(guessSources("红烧肉盖饭").map((s) => s.name), ["猪肉", "米饭"]);
  assert.deepEqual(guessSources("鱼香茄子"), []); // "鱼" alone must not turn into fish
  assert.deepEqual(guessSources("可乐"), []);
});

const out: MenuModelOutput = {
  error: null,
  merchant: " 二食堂 3 号窗口 ",
  dishes: [
    { name: "卤鸡腿饭", price: 12, protein_sources: [{ name: "鸡腿", qty: 1 }, { name: "米饭", qty: 1 }, { name: "蔬菜", qty: 1 }],
      protein_low_g: 20, protein_high_g: 30, kcal_low: 600, kcal_high: 800, confidence: "medium", basis: "按一只琵琶腿加一碗米饭" },
    { name: "招牌秘制套餐", price: 18, protein_sources: [{ name: "秘制酱肉", qty: 1 }],
      protein_low_g: 15, protein_high_g: 30, kcal_low: 700, kcal_high: 1100, confidence: "medium", basis: "菜名含糊" },
    { name: "煎饼果子加蛋", price: 8, protein_sources: [],
      protein_low_g: 12, protein_high_g: 20, kcal_low: 450, kcal_high: 650, confidence: "medium", basis: "" },
    { name: "可乐", price: 3, protein_sources: [], protein_low_g: 0, protein_high_g: 1, kcal_low: 120, kcal_high: 160, confidence: "medium", basis: "含糖饮料" },
    { name: "每日例汤", price: null, protein_sources: [], protein_low_g: 2, protein_high_g: 8, kcal_low: 40, kcal_high: 150, confidence: "low", basis: "不知道是什么汤" },
    { name: "卤鸡腿饭", price: 12, protein_sources: [], protein_low_g: 20, protein_high_g: 30, kcal_low: 600, kcal_high: 800, confidence: "medium", basis: "重复项" },
    { name: "免费小菜", price: -5, protein_sources: [{ name: "蔬菜", qty: 1 }], protein_low_g: 1, protein_high_g: 2, kcal_low: 20, kcal_high: 60, confidence: "medium", basis: "" },
    { name: "白米饭", price: 1, protein_sources: [{ name: "米饭", qty: 1 }], protein_low_g: 4, protein_high_g: 6, kcal_low: 200, kcal_high: 260, confidence: "medium", basis: "" },
  ],
};
assert.ok(MenuModelSchema.safeParse(out).success);
const res = postProcessMenu(out, { type: "photo", content: "x" });
assert.ok(res.ok);
const items = res.ok ? res.items : [];

test("post-process: table arithmetic replaces the model's protein, capped at medium", () => {
  assert.equal(res.ok && res.merchant, "二食堂 3 号窗口");
  assert.equal(items.length, 7); // duplicate dropped
  assert.deepEqual(items.map((i) => !!i.side), [false, false, false, false, false, true, true]); // 免费小菜, 白米饭
  const leg = items[0];
  // 鸡腿 18 + 米饭 5 + 蔬菜 1.5 = 24.5 → ±25% = 18.4–30.6 → 18–31（鸡腿 2026-11-13 核对后由 17 改为 18）
  assert.deepEqual([leg.protein_low_g, leg.protein_high_g, leg.source, leg.confidence], [18, 31, "ingredient_table", "medium"]);
  assert.deepEqual(leg.components, ["鸡腿×1", "米饭×1", "蔬菜×1"]);
  assert.deepEqual([leg.kcal_low, leg.kcal_high], [595, 805]); // model kcal kept, widened to the medium minimum
  assert.ok(leg.basis.includes("未逐行核实"));
});

test("post-process: unresolved source → model range at low; empty sources → street recipe", () => {
  const set = items[1];
  assert.deepEqual([set.protein_low_g, set.protein_high_g, set.source, set.confidence], [15, 30, "text_estimate", "low"]);
  const jb = items[2];
  // 煎饼面糊 5 + 鸡蛋 2 + 薄脆 2 = 20 → 15–25
  assert.deepEqual([jb.protein_low_g, jb.protein_high_g, jb.source], [15, 25, "ingredient_table"]);
  assert.ok(jb.basis.includes("煎饼果子"));
});

test("post-process: prices are never invented or negative", () => {
  assert.equal(items[4].price, null);
  assert.equal(items[5].price, null); // -5 dropped
  const typed = postProcessMenu(
    { error: null, merchant: null, dishes: [{ ...out.dishes[0], price: 12 }] },
    { type: "text", content: "鸡腿饭、牛肉面" }, // no digit in the input → no price possible
  );
  assert.equal(typed.ok && typed.items[0].price, null);
  const empty = postProcessMenu({ error: "这不是菜单", merchant: null, dishes: [] }, { type: "photo", content: "x" });
  assert.deepEqual(empty, { ok: false, error: "这不是菜单", retryable: true });
});

test("ranking: by 分/g with a range, unpriced and near-zero-protein dishes listed apart", () => {
  const { ranked, unranked } = rankMenu(items, "cpg", 10);
  // 煎饼果子加蛋 8/20 = 40.0; 卤鸡腿饭 12/24.5 = 49.0; 招牌秘制套餐 18/22.5 = 80.0
  assert.deepEqual(ranked.map((r) => r.name), ["煎饼果子加蛋", "卤鸡腿饭", "招牌秘制套餐"]);
  assert.deepEqual(ranked.map((r) => r.cpg.toFixed(1)), ["40.0", "49.0", "80.0"]);
  const leg = ranked[1];
  assert.deepEqual([leg.cpgLow.toFixed(1), leg.cpgHigh.toFixed(1)], ["38.7", "66.7"]); // 1200/31, 1200/18
  assert.deepEqual(ranked.map((r) => r.over), [false, true, true]); // spendable ¥10
  // 白米饭 is ¥1 for ~5 g (20 分/g, "better" than everything) but is a plain staple: never ranked
  assert.deepEqual(unranked.map((u) => u.name), ["可乐", "每日例汤", "免费小菜", "白米饭"]);
  assert.deepEqual(rankMenu(items, "protein").ranked.map((r) => r.name), ["卤鸡腿饭", "招牌秘制套餐", "煎饼果子加蛋"]);
});

test("a picked dish becomes a normal estimate item with the same numbers", () => {
  const e = toEstimateItem(items[0], "二食堂 3 号窗口");
  assert.deepEqual([e.meal_name, e.merchant, e.amount_usd, e.protein_low_g, e.protein_high_g, e.source], ["卤鸡腿饭", "二食堂 3 号窗口", 12, 18, 31, "ingredient_table"]);
});

test("mock: a typed menu goes through the same pipeline", () => {
  const input = { type: "text" as const, content: "鸡腿饭 12、番茄炒蛋盖饭 8 元、牛肉面16、可乐 3" };
  const r = postProcessMenu(mockMenuOutput(input), input);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.items.map((i) => [i.name, i.price]), [["鸡腿饭", 12], ["番茄炒蛋盖饭", 8], ["牛肉面", 16], ["可乐", 3]]);
  // 番茄炒蛋盖饭 = 鸡蛋 2 + 米饭 1 = 18 → 14–23; 8/18.5 = 43.2 分/g, the best of the four
  const { ranked, unranked } = rankMenu(r.items);
  assert.deepEqual(ranked.map((x) => x.name), ["番茄炒蛋盖饭", "鸡腿饭", "牛肉面"]);
  assert.equal(ranked[0].cpg.toFixed(1), "43.2");
  assert.deepEqual(unranked.map((x) => x.name), ["可乐"]);
});

test("prompt carries both tables", () => {
  const text = menuSystemBlocks()[0].text;
  assert.ok(text.includes("鸡大腿") && text.includes("煎饼果子") && text.includes("排序不归你管"));
  console.log(`     (menu prompt ~${Math.round(text.length / 1.6)} tokens est.)`);
});

console.log(`\n${n} menu tests passed`);
