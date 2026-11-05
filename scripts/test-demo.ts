// Offline tests for the paid-amount allocation and the example data. Run: npx tsx scripts/test-demo.ts
import assert from "node:assert/strict";
import { allocateToPaid, postProcess } from "../lib/estimate/estimate";
import type { EstimateItem } from "../lib/estimate/schema";
import { DEMO_ORDER_COUNT, demoMeals, demoSettings } from "../lib/demo";
import { buildNextMeal } from "../lib/next-meal";
import { buildWeeklyReport } from "../lib/weekly";
import { startOfDay, startOfWeek, addDays } from "../lib/dates";
import demoData from "../data/demo-orders.json";

const item = (name: string, amount: number | null): EstimateItem => ({
  meal_name: name, merchant: "x", amount_usd: amount, kcal_low: 100, kcal_high: 200, protein_low_g: 5, protein_high_g: 10,
  confidence: "medium", basis: "估算", source: "visual_estimate",
});

// 金戈戈 order: 38.8 + 5.9 + 1.9 = 46.6 listed, 38.6 paid (红包 −13, 打包 +5). Factor 0.8283.
const paid = allocateToPaid([item("至尊豉油鸡腿饭", 38.8), item("蒸水蛋", 5.9), item("咸鸭蛋(半个)", 1.9), item("无价小菜", null)], 38.6);
assert.deepEqual(paid.map((i) => i.amount_usd), [32.14, 4.89, 1.57, null]);
assert.equal(Math.round(paid.reduce((a, i) => a + (i.amount_usd ?? 0), 0) * 100), 3860); // adds up exactly
assert.ok(paid[0].basis.includes("标价 ¥38.8") && paid[0].basis.includes("实付 ¥32.14"));
assert.equal(paid[3].basis, "估算"); // unpriced item untouched
console.log("  ok - listed prices are scaled to what was paid, to the cent");

// Fees push the total above the listed price: 29.6 listed, 30.1 paid.
assert.deepEqual(allocateToPaid([item("客家酿豆腐套餐", 29.6)], 30.1).map((i) => i.amount_usd), [30.1]);
// No total, same total, or an implausible ratio (misread receipt): listed prices are kept.
const same = [item("a", 10), item("b", 5)];
assert.equal(allocateToPaid(same, null), same);
assert.equal(allocateToPaid(same, 15), same);
assert.equal(allocateToPaid(same, 2), same); // 0.13×: probably missing dishes or a wrong total
assert.equal(allocateToPaid(same, 40), same); // 2.7×
assert.equal(allocateToPaid([item("a", null)], 20)[0].amount_usd, null);
console.log("  ok - fees scale up; missing or implausible totals leave prices alone");

// Only receipts are re-priced: a typed sentence keeps the numbers the user typed.
const model = { error: null, merchant: null, total_usd: 20, grocery_ingredients: null, items: [{
  meal_name: "鸡腿饭", amount_usd: 25, chain_match: null, dining_match: null, kcal_low: 600, kcal_high: 800,
  protein_low_g: 20, protein_high_g: 30, confidence: "medium" as const, basis: "估算", portion: null }] };
const asText = postProcess(model, { type: "text", content: "鸡腿饭 25" });
const asReceipt = postProcess(model, { type: "receipt", content: "x" });
assert.equal(asText.ok && asText.kind === "meal" && asText.items[0].amount_usd, 25);
assert.equal(asReceipt.ok && asReceipt.kind === "meal" && asReceipt.items[0].amount_usd, 20);
console.log("  ok - allocation applies to receipts only");

// ---- example data ----
assert.equal(DEMO_ORDER_COUNT, 13);
for (const o of demoData.orders) {
  const sum = o.items.reduce((a, i) => a + (i.amount ?? 0), 0);
  assert.equal(Math.round(sum * 100), Math.round(o.paid * 100), `${o.shop}: dishes must add up to the amount paid`);
  assert.ok(!/[((].*店[))]/.test(o.shop), `${o.shop}: branch names stay out of the public repo`);
  assert.ok(o.items.every((i) => i.protein_low_g < i.protein_high_g && i.meal_name));
}
const totalPaid = demoData.orders.reduce((a, o) => a + o.paid, 0);
assert.equal(Math.round(totalPaid * 10) / 10, 740.5); // 13 orders as on the screenshots
console.log("  ok - 13 orders, every one adds up to its paid total (¥740.5 in all), no branch names");

let n = 0;
const id = () => `d${++n}`;
for (const now of [new Date(2026, 10, 4, 21, 0).getTime(), new Date(2026, 10, 9, 8, 30).getTime()]) { // a Wednesday evening, a Monday morning
  const meals = demoMeals(now, id);
  assert.equal(meals.length, demoData.orders.reduce((a, o) => a + o.items.length, 0));
  assert.ok(meals.every((m) => m.demo && m.ts <= now && m.ts > now - 12.5 * 86400e3 && m.input_type === "receipt"));
  const today = meals.filter((m) => m.ts >= startOfDay(now).getTime());
  assert.ok(today.length >= 1, "today is never empty");
  // The home list and the weekly report both have something to show.
  const s = demoSettings(now);
  const week = meals.filter((m) => m.ts >= startOfWeek(now).getTime());
  const nm = buildNextMeal(meals, week, today, s, now, []);
  assert.ok(nm.state === "ok" || nm.state === "over_budget");
  assert.ok(nm.options.length >= 3);
  const prev = meals.filter((m) => m.ts >= addDays(startOfWeek(now), -7).getTime() && m.ts < startOfWeek(now).getTime());
  const rep = buildWeeklyReport(week, prev, s, now);
  assert.ok(rep.ranking.length >= 1 && rep.daysRecorded >= 1);
}
console.log("  ok - example records sit in the past on any weekday; home list and weekly report are populated");

console.log("\ndemo tests passed");
