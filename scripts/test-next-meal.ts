// Hand-calculated check of the 下一顿 card (PRD F0-1). Run: npx tsx scripts/test-next-meal.ts
import assert from "node:assert/strict";
import { buildNextMeal, pricedDishes, spendableToday } from "../lib/next-meal";
import { addDays, startOfWeek } from "../lib/dates";
import type { Meal, Settings } from "../lib/types";

const settings: Settings = { protein_target_g: 100, weekly_budget_usd: 140, created_at: 0 };
const ws = startOfWeek(new Date(2026, 10, 4)); // Mon 2026-11-02
const at = (day: number, hour: number) => addDays(ws, day).getTime() + hour * 3600e3;
const now = at(2, 18); // Wednesday 18:00 -> 5 days left in the week including today

let n = 0;
const meal = (p: Partial<Meal> & { ts: number; meal_name: string }): Meal => ({
  id: String(++n), kind: "meal", input_type: "text", merchant: null, amount_usd: null,
  kcal_low: 0, kcal_high: 0, protein_low_g: 0, protein_high_g: 0, confidence: "medium",
  basis: "", source: "text_estimate", user_corrected: false, ...p,
});

// Older history (last week): eggs twice, 外卖 once, a free meal, a scoop of whey.
const older: Meal[] = [
  meal({ ts: at(-5, 8), meal_name: "鸡蛋 2 个", amount_usd: 3, protein_low_g: 12, protein_high_g: 14 }),
  meal({ ts: at(-4, 8), meal_name: "鸡蛋 2 个", amount_usd: 3, protein_low_g: 12, protein_high_g: 14 }),
  meal({ ts: at(-3, 19), meal_name: "外卖黄焖鸡", merchant: "美团", amount_usd: 22, protein_low_g: 28, protein_high_g: 40 }),
  meal({ ts: at(-3, 12), meal_name: "免费披萨", protein_low_g: 10, protein_high_g: 20 }),
  meal({ ts: at(-2, 9), meal_name: "蛋白粉 1 勺", amount_usd: 2, protein_low_g: 22, protein_high_g: 26, supplement: true }),
];
// This week: Mon ¥28 and Tue ¥12 (two 食堂鸡腿饭 among them), today ¥8 so far.
const mon = meal({ ts: at(0, 12), meal_name: "食堂鸡腿饭", merchant: "二食堂", amount_usd: 12, protein_low_g: 20, protein_high_g: 30 });
const monDinner = meal({ ts: at(0, 19), meal_name: "牛肉面", amount_usd: 16, protein_low_g: 18, protein_high_g: 26 });
const tue = meal({ ts: at(1, 12), meal_name: "食堂鸡腿饭", merchant: "二食堂", amount_usd: 12, protein_low_g: 20, protein_high_g: 30 });
const todayLunch = meal({ ts: at(2, 12), meal_name: "食堂番茄炒蛋盖饭", amount_usd: 8, protein_low_g: 20, protein_high_g: 30 });
const week = [mon, monDinner, tue, todayLunch];
const today = [todayLunch];
const history = [...older, ...week];

// spendable: (140 − 40 spent before today) / 5 days = 20 per day; minus 8 today = 12
assert.equal(spendableToday(week, settings, now), 12);
console.log("  ok - today's spendable money spreads the remaining budget over the days left");

// dishes by 分/g: 鸡蛋 3/13 = 23.1, 食堂番茄炒蛋盖饭 8/25 = 32, 食堂鸡腿饭 24/50 = 48, 外卖黄焖鸡 22/34 = 64.7, 牛肉面 16/22 = 72.7
const dishes = pricedDishes(history);
assert.deepEqual(dishes.map((d) => d.meal.meal_name), ["鸡蛋 2 个", "食堂番茄炒蛋盖饭", "食堂鸡腿饭", "外卖黄焖鸡", "牛肉面"]);
assert.deepEqual(dishes.map((d) => d.cpg.toFixed(1)), ["23.1", "32.0", "48.0", "64.7", "72.7"]);
assert.equal(dishes[2].times, 2);
assert.equal(dishes[2].meal.id, tue.id); // a tap re-logs the latest record
console.log("  ok - priced food only, cheapest protein first; free meals and supplements left out");

// deficit 100 − 25 = 75; affordable (≤ ¥12): 鸡蛋, 番茄炒蛋盖饭, 食堂鸡腿饭
const nm = buildNextMeal(history, week, today, settings, now);
assert.equal(nm.state, "ok");
assert.equal(nm.deficit, 75);
assert.deepEqual(nm.options.map((o) => [o.meal.meal_name, o.amount, o.over]), [["鸡蛋 2 个", 3, false], ["食堂番茄炒蛋盖饭", 8, false], ["食堂鸡腿饭", 12, false]]);
console.log("  ok - options fit today's money and are ordered by 分/g");

// Tight day: ¥18 already spent today -> spendable 2 -> nothing fits, cheapest three shown flagged.
const bigLunch = meal({ ts: at(2, 12), meal_name: "食堂番茄炒蛋盖饭", amount_usd: 18, protein_low_g: 20, protein_high_g: 30 });
const tight = buildNextMeal([...older, mon, monDinner, tue, bigLunch], [mon, monDinner, tue, bigLunch], [bigLunch], settings, now);
assert.equal(tight.spendable, 2);
assert.equal(tight.state, "over_budget");
assert.equal(tight.options.length, 3);
assert.ok(tight.options.every((o) => o.over));
assert.equal(tight.options[0].meal.meal_name, "鸡蛋 2 个");
console.log("  ok - nothing affordable: cheapest protein still shown, flagged");

// Target met and empty history.
const big = meal({ ts: at(2, 13), meal_name: "鸡胸 ×3", amount_usd: 6, protein_low_g: 90, protein_high_g: 110 });
assert.equal(buildNextMeal(history, [...week, big], [todayLunch, big], settings, now).state, "met");
assert.equal(buildNextMeal([], [], [], settings, now).state, "no_history");
assert.equal(buildNextMeal([older[3], older[4]], [], [], settings, now).state, "no_history"); // only a free meal and whey
// Overspent week never yields a negative amount.
assert.equal(spendableToday([meal({ ts: at(0, 12), meal_name: "聚餐", amount_usd: 300 })], settings, now), 0);
console.log("  ok - met / no history / overspent week");

console.log("\nnext-meal tests passed");
