// Hand-calculated check of the post-save feedback (即时回报). Run: npx tsx scripts/test-feedback.ts
import assert from "node:assert/strict";
import { buildFeedback, cheapestInHistory, feedbackLine } from "../lib/feedback";
import { mockModelOutput } from "../lib/estimate/mock";
import { postProcess } from "../lib/estimate/estimate";
import type { Meal, Settings } from "../lib/types";

const settings: Settings = { protein_target_g: 100, weekly_budget_usd: 500, created_at: 0 };
let n = 0;
const meal = (p: Partial<Meal> & { ts: number; meal_name: string }): Meal => ({
  id: String(++n), kind: "meal", input_type: "text", merchant: null, amount_usd: null,
  kcal_low: 0, kcal_high: 0, protein_low_g: 0, protein_high_g: 0, confidence: "medium",
  basis: "", source: "text_estimate", user_corrected: false, ...p,
});
const H = 3600e3;
const now = Date.now();

// History (older days): eggs are the cheapest protein the user has ever logged.
const history: Meal[] = [
  meal({ ts: now - 5 * 24 * H, meal_name: "鸡蛋", amount_usd: 1.5, protein_low_g: 6, protein_high_g: 7 }), // 1.5/6.5 = 23 分/g
  meal({ ts: now - 4 * 24 * H, meal_name: "鸡蛋", amount_usd: 1.5, protein_low_g: 6, protein_high_g: 7 }),
  meal({ ts: now - 3 * 24 * H, meal_name: "外卖黄焖鸡", merchant: "美团", amount_usd: 22, protein_low_g: 28, protein_high_g: 40 }), // 64.7
];
// This week so far: one priced meal already, then the one just saved.
const earlier = meal({ ts: now - 6 * H, meal_name: "食堂鸡腿饭", amount_usd: 12, protein_low_g: 20, protein_high_g: 30 }); // 48 分/g
const saved = meal({ ts: now, meal_name: "麦辣鸡腿堡", merchant: "麦当劳", amount_usd: 20, protein_low_g: 22, protein_high_g: 26 }); // 83.3 分/g
const week = [earlier, saved];
const today = [earlier, saved];

const f = buildFeedback([saved], week, today, [...history, ...week], settings);
// rank: this week's priced rows = 食堂鸡腿饭 48, 麦辣鸡腿堡 83.3 -> saved is #2 of 2
assert.equal(f.rank?.rank, 2);
assert.equal(f.rank?.total, 2);
assert.equal(f.rank?.cpg.toFixed(1), "83.3");
console.log("  ok - rank within this week");

// eaten mid = 25 + 24 = 49; deficit = 51
assert.equal(f.eatenMid, 49);
assert.equal(f.deficit, 51);
// suggestion: cheapest in history is 鸡蛋 (23.08 分/g, 6.5 g/portion); 51/6.5 = 7.8 -> capped at 3 portions, 3 × ¥1.5 = ¥4.5
assert.equal(f.suggestion?.name, "鸡蛋");
assert.equal(f.suggestion?.portions, 3);
assert.equal(f.suggestion?.cost, 4.5);
assert.equal(feedbackLine(f), "还差 51 g · 本周第 2 划算");
console.log("  ok - gap expressed as cheapest item in own history, capped at 3 portions");

// Unpriced save: no rank, but the gap still shows.
const free = meal({ ts: now, meal_name: "免费披萨", protein_low_g: 10, protein_high_g: 20 });
const f2 = buildFeedback([free], [earlier, free], [earlier, free], history, settings);
assert.equal(f2.rank, null);
assert.equal(f2.unpriced, true);
assert.equal(f2.deficit, 100 - 25 - 15);
console.log("  ok - unpriced meal: no rank, gap still computed");

// Target met: no suggestion.
const big = meal({ ts: now, meal_name: "鸡胸 ×3", amount_usd: 30, protein_low_g: 90, protein_high_g: 110 });
const f3 = buildFeedback([big], [big], [big], history, settings);
assert.equal(f3.deficit, 0);
assert.equal(f3.suggestion, null);
assert.equal(feedbackLine(f3), "今天已到目标 · 本周第 1 划算");
console.log("  ok - target met: no suggestion");

// No priced history: gap but no suggestion.
const f4 = buildFeedback([free], [free], [free], [], settings);
assert.equal(f4.suggestion, null);
assert.equal(cheapestInHistory([]), null);
console.log("  ok - empty history: no suggestion");

// 日结 mock: one sentence -> one item per 顿, each with its own price.
const day = postProcess(
  mockModelOutput({ type: "text", content: "早饭鸡蛋牛奶 5 元、午饭食堂鸡腿饭 12 元、一勺蛋白粉", batch: true }),
  { type: "text", content: "早饭鸡蛋牛奶 5 元、午饭食堂鸡腿饭 12 元、一勺蛋白粉", batch: true },
);
assert.ok(day.ok && day.kind === "meal");
if (day.ok && day.kind === "meal") {
  assert.equal(day.items.length, 3);
  assert.deepEqual(day.items.map((i) => i.amount_usd), [5, 12, null]);
  assert.equal(day.total_usd, 17);
  assert.equal(day.items[0].meal_name, "早饭鸡蛋牛奶");
  assert.ok(day.items[2].meal_name.includes("蛋白粉"));
  assert.ok((day.items[2].protein_low_g ?? 0) >= 18);
}
console.log("  ok - 日结 sentence splits into one item per 顿");

console.log("\nfeedback tests passed");
