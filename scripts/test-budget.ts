// Hand-calculated check of 每天的预算 and the 花超提醒 (2026-11-05). Run: npx tsx scripts/test-budget.ts
import assert from "node:assert/strict";
import { adviceSentence } from "../lib/derive";
import { overspendHead, overspendLine, spendableToday, todayBudget } from "../lib/next-meal";
import { dailyBudgetOf, weeklyFromDaily } from "../lib/settings";
import { addDays, startOfWeek } from "../lib/dates";
import type { Meal, Settings } from "../lib/types";

// ¥40 a day -> ¥280 a week.
const settings: Settings = { protein_target_g: 100, weekly_budget_usd: weeklyFromDaily(40), created_at: 0 };
const ws = startOfWeek(new Date(2026, 10, 4)); // Mon 2026-11-02
const at = (day: number, hour: number) => addDays(ws, day).getTime() + hour * 3600e3;

let n = 0;
const paid = (day: number, hour: number, amount: number): Meal => ({
  id: String(++n), ts: at(day, hour), kind: "meal", input_type: "text", meal_name: `饭 ${n}`, merchant: null, amount_usd: amount,
  kcal_low: 0, kcal_high: 0, protein_low_g: 20, protein_high_g: 30, confidence: "medium",
  basis: "", source: "text_estimate", user_corrected: false,
});

// The forms take a per-day amount; storage keeps seven of them.
assert.equal(settings.weekly_budget_usd, 280);
assert.equal(dailyBudgetOf(settings), 40);
assert.equal(dailyBudgetOf({ weekly_budget_usd: 500 }), 71.43);
assert.equal(weeklyFromDaily(71.43, 500), 500); // an old weekly figure survives an unchanged save
assert.equal(weeklyFromDaily(71.44, 500), 500.08); // a one-cent change does go through
assert.equal(weeklyFromDaily(0), 0);
assert.equal(weeklyFromDaily(Number("abc")), 0);
assert.equal(weeklyFromDaily(-5), 0);
console.log("  ok - budget is entered per day and stored as a week; old weekly figures are not disturbed");

// Monday morning, nothing spent: today's budget is the day amount.
const mon = todayBudget([], settings, at(0, 9));
assert.deepEqual(mon, { base: 40, allowance: 40, spent: 0, left: 40, over: 0, daysAfter: 6, next: 40, cut: 0 });
assert.equal(overspendLine(mon), null);
// First visit on a Thursday, nothing recorded for Mon–Wed: still ¥40, not 280 / 4 = ¥70.
assert.equal(todayBudget([], settings, at(3, 9)).allowance, 40);
console.log("  ok - a day never gets more than the amount the user set, even with nothing recorded earlier in the week");

// Wednesday: Mon ¥30 + Tue ¥60 = ¥90 before today -> (280 − 90) / 5 = ¥38 today. ¥46 spent -> ¥8 over.
const week = [paid(0, 12, 30), paid(1, 12, 60), paid(2, 12, 20), paid(2, 18, 26)];
const wed = todayBudget(week, settings, at(2, 19));
assert.deepEqual(wed, { base: 40, allowance: 38, spent: 46, left: 0, over: 8, daysAfter: 4, next: 36, cut: 2 });
assert.equal(spendableToday(week, settings, at(2, 19)), 0);
assert.equal(overspendHead(wed), "今天花超 ¥8");
assert.equal(overspendLine(wed), "今天花超 ¥8,本周剩下 4 天每天少 ¥2");
// ...and Thursday's budget really is ¥2 lower: (280 − 136) / 4 = 36.
assert.equal(todayBudget(week, settings, at(3, 9)).allowance, 36);
console.log("  ok - going over is allowed; the reminder states the amount and what it takes off the days left");

// One very expensive dinner: ¥38 today, ¥20 + ¥180 spent -> ¥162 over, more than the 4 days left hold (4 × 38 = 152).
const feast = todayBudget([...week.slice(0, 3), paid(2, 19, 180)], settings, at(2, 20));
assert.equal(feast.over, 162);
assert.equal(overspendLine(feast), "今天花超 ¥162,本周剩下 4 天的预算也花完了");
console.log("  ok - over by more than the rest of the week holds: the reminder says nothing is left");

// Still inside the budget at lunch: no reminder, and what is left is the difference.
const wedLunch = todayBudget(week.slice(0, 3), settings, at(2, 13));
assert.deepEqual([wedLunch.spent, wedLunch.left, wedLunch.over], [20, 18, 0]);
assert.equal(overspendLine(wedLunch), null);
console.log("  ok - no reminder while today is within budget");

// Money saved earlier in the week (Mon ¥10 + Tue ¥10) does not raise today above ¥40, but it absorbs
// overspending: ¥50 today is ¥10 over, and tomorrow is still min(40, (280 − 70) / 4 = 52.5) = ¥40.
const saved = [paid(0, 12, 10), paid(1, 12, 10)];
assert.equal(todayBudget(saved, settings, at(2, 9)).allowance, 40);
const covered = todayBudget([...saved, paid(2, 12, 50)], settings, at(2, 13));
assert.deepEqual([covered.over, covered.next, covered.cut], [10, 40, 0]);
assert.equal(overspendLine(covered), "今天花超 ¥10,本周前几天省下的够抵,后面几天不变");
console.log("  ok - earlier savings do not raise a day, but they cover overspending before the days left are cut");

// Sunday: ¥250 before today -> ¥30 left for the last day; ¥45 spent -> ¥15 over, and there is no day left to take it from.
const sunWeek = [paid(0, 12, 125), paid(3, 12, 125), paid(6, 12, 45)];
const sun = todayBudget(sunWeek, settings, at(6, 20));
assert.deepEqual([sun.allowance, sun.over, sun.daysAfter, sun.next], [30, 15, 0, null]);
assert.equal(overspendLine(sun), "今天花超 ¥15");
console.log("  ok - on the last day of the week the reminder is just the amount");

// The week's money is already gone: today's budget is ¥0, never negative, and anything spent is over.
const blown = todayBudget([paid(0, 12, 150), paid(1, 12, 150), paid(2, 12, 10)], settings, at(2, 13));
assert.deepEqual([blown.allowance, blown.left, blown.over], [0, 0, 10]);
assert.equal(overspendLine(blown), "今天花超 ¥10,本周的预算已经花完");
console.log("  ok - a spent-out week gives a ¥0 day, not a negative one");

// The fixed sentence on the home card talks about today.
assert.equal(adviceSentence(58, 18), "今天蛋白还差约 58g,今天预算还剩 ¥18。");
assert.equal(adviceSentence(58, 0, "CNY", overspendLine(wed)), "今天蛋白还差约 58g,今天花超 ¥8,本周剩下 4 天每天少 ¥2。");
assert.equal(adviceSentence(-5, 12.5), "今天蛋白已到目标(约多 5g),今天预算还剩 ¥12.50。");
console.log("  ok - the home sentence states today's money, or the reminder once it is over");

console.log("budget: all passed");
