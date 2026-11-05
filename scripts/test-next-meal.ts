// Hand-calculated check of the 下一顿 card (PRD F0-1). Run: npx tsx scripts/test-next-meal.ts
import assert from "node:assert/strict";
import { buildNextMeal, candidates, menuDishes, pricedDishes, spendableToday } from "../lib/next-meal";
import { mealFromDish, upsertMenu, type MenuItem, type SavedMenu } from "../lib/menu-rank";
import { starterMenu } from "../lib/starter";
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
assert.deepEqual(dishes.map((d) => d.name), ["鸡蛋 2 个", "食堂番茄炒蛋盖饭", "食堂鸡腿饭", "外卖黄焖鸡", "牛肉面"]);
assert.deepEqual(dishes.map((d) => d.cpg.toFixed(1)), ["23.1", "32.0", "48.0", "64.7", "72.7"]);
assert.equal(dishes[2].times, 2);
assert.equal(dishes[2].meal?.id, tue.id); // a tap re-logs the latest record
console.log("  ok - priced food only, cheapest protein first; free meals and supplements left out");

// deficit 100 − 25 = 75; affordable (≤ ¥12): 鸡蛋, 番茄炒蛋盖饭, 食堂鸡腿饭
const nm = buildNextMeal(history, week, today, settings, now);
assert.equal(nm.state, "ok");
assert.equal(nm.deficit, 75);
assert.deepEqual(nm.options.map((o) => [o.name, o.amount, o.over]), [["鸡蛋 2 个", 3, false], ["食堂番茄炒蛋盖饭", 8, false], ["食堂鸡腿饭", 12, false]]);
console.log("  ok - options fit today's money and are ordered by 分/g");

// Tight day: ¥18 already spent today -> spendable 2 -> nothing fits, cheapest three shown flagged.
const bigLunch = meal({ ts: at(2, 12), meal_name: "食堂番茄炒蛋盖饭", amount_usd: 18, protein_low_g: 20, protein_high_g: 30 });
const tight = buildNextMeal([...older, mon, monDinner, tue, bigLunch], [mon, monDinner, tue, bigLunch], [bigLunch], settings, now);
assert.equal(tight.spendable, 2);
assert.equal(tight.state, "over_budget");
assert.equal(tight.options.length, 3);
assert.ok(tight.options.every((o) => o.over));
assert.equal(tight.options[0].name, "鸡蛋 2 个");
console.log("  ok - nothing affordable: cheapest protein still shown, flagged");

// Target met and empty history.
const big = meal({ ts: at(2, 13), meal_name: "鸡胸 ×3", amount_usd: 6, protein_low_g: 90, protein_high_g: 110 });
assert.equal(buildNextMeal(history, [...week, big], [todayLunch, big], settings, now).state, "met");
assert.equal(buildNextMeal([], [], [], settings, now).state, "no_history");
assert.equal(buildNextMeal([older[3], older[4]], [], [], settings, now).state, "no_history"); // only a free meal and whey
// Overspent week never yields a negative amount.
assert.equal(spendableToday([meal({ ts: at(0, 12), meal_name: "聚餐", amount_usd: 300 })], settings, now), 0);
console.log("  ok - met / no history / overspent week");

// ---- 每日清单: dishes from saved menus join the list without a photo ----
const dish = (id: string, name: string, price: number | null, pl: number, ph: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id, name, price, kcal_low: 100, kcal_high: 200, protein_low_g: pl, protein_high_g: ph,
  confidence: "medium", basis: "食材表", source: "ingredient_table", ...extra,
});
const laowang: SavedMenu = {
  id: "m1", name: "老王快餐", ts: at(-1, 12),
  items: [
    dish("0", "卤蛋", 2, 5, 8), // 2/6.5 = 30.8 分/g
    dish("1", "黄焖鸡米饭(小份)", 16, 25, 41), // 16/33 = 48.5, over ¥12
    dish("2", "米饭", 1, 4, 6, { side: true }), // staple: never ranked
    dish("3", "可乐", 3, 0, 1, { source: "text_estimate" }),
    dish("4", "每日例汤", null, 2, 8),
  ],
};
const canteen: SavedMenu = {
  id: "m2", name: "二食堂", ts: at(-2, 12),
  items: [dish("0", "食堂鸡腿饭", 12, 18, 29), dish("1", "红烧牛肉面", 16, 13, 22)], // the first one is already in the history
};
const md = menuDishes([laowang, canteen]);
assert.deepEqual(md.map((o) => `${o.venue}/${o.name}`), ["老王快餐/卤蛋", "老王快餐/黄焖鸡米饭(小份)", "二食堂/食堂鸡腿饭", "二食堂/红烧牛肉面"]);
console.log("  ok - saved menus contribute only ranked dishes (priced, real protein source)");

// History wins over the menu row for the same place + dish; never-eaten dishes come in with times 0.
const all = candidates(history, [laowang, canteen]);
const leg = all.filter((o) => o.name === "食堂鸡腿饭");
assert.equal(leg.length, 1);
assert.ok(leg[0].meal && !leg[0].dish && leg[0].times === 2);
const egg = all.find((o) => o.name === "卤蛋")!;
assert.ok(egg.dish && !egg.meal && egg.times === 0 && egg.venue === "老王快餐");
console.log("  ok - a dish already logged at that place is not listed twice");

// Same day as above (spendable ¥12, gap 75 g): 鸡蛋 23.1, 卤蛋 30.8, 番茄炒蛋盖饭 32, 食堂鸡腿饭 48; the ¥16 dishes do not fit.
const withMenus = buildNextMeal(history, week, today, settings, now, [laowang, canteen]);
assert.equal(withMenus.state, "ok");
assert.deepEqual(withMenus.options.map((o) => [o.name, o.cpg.toFixed(1), o.times]), [
  ["鸡蛋 2 个", "23.1", 2], ["卤蛋", "30.8", 0], ["食堂番茄炒蛋盖饭", "32.0", 1], ["食堂鸡腿饭", "48.0", 2],
]);
assert.equal(withMenus.candidates, 8); // 5 logged dishes + 4 rankable menu dishes − 1 duplicate (食堂鸡腿饭)
console.log("  ok - daily list mixes logged dishes and saved-menu dishes, cheapest protein first");

// A brand-new user with one saved menu and no records gets a list at once.
const fresh = buildNextMeal([], [], [], settings, now, [laowang]);
assert.equal(fresh.state, "ok");
assert.deepEqual(fresh.options.map((o) => o.name), ["卤蛋", "黄焖鸡米饭(小份)"]); // spendable 140/5 = 28
console.log("  ok - zero records + one saved menu still yields a list");

// Tapping a never-eaten dish records it from the menu numbers.
const rec = mealFromDish(egg.dish!, egg.venue, "new", now);
assert.deepEqual([rec.meal_name, rec.merchant, rec.amount_usd, rec.protein_low_g, rec.protein_high_g, rec.input_type, rec.source], ["卤蛋", "老王快餐", 2, 5, 8, "menu", "ingredient_table"]);
// Scanning the same place again replaces its dishes instead of adding a second entry.
const again = upsertMenu([laowang, canteen], " 老王 快餐 ", [dish("0", "卤蛋", 2.5, 5, 8)], "fresh-id", now);
assert.deepEqual([again.id, again.name, again.items.length], ["m1", "老王 快餐", 1]);
assert.equal(upsertMenu([laowang], "新开的店", [], "fresh-id", now).id, "fresh-id");
assert.equal(upsertMenu([], "  ", [], "x", now).name, "未命名菜单");
console.log("  ok - picking from a saved menu makes a record; rescanning a place updates it");

// Renaming a place must not bring back a dish the user already picked from it.
const picked = mealFromDish(egg.dish!, "老王快餐", "picked", at(1, 12), "m1");
assert.equal(picked.menu_id, "m1");
const renamed: SavedMenu = { ...laowang, name: "老王快餐(北门)" };
const afterRename = candidates([picked], [renamed]).filter((o) => o.name === "卤蛋");
assert.equal(afterRename.length, 1);
assert.ok(afterRename[0].meal && afterRename[0].times === 1);
console.log("  ok - a renamed place does not duplicate dishes already picked from it");

// The starter list fills in only during cold start.
const starter = starterMenu(at(-10, 0));
// Enough of the user's own rows fit today's money (3 or more): no starter rows at all.
const settled = buildNextMeal(history, week, today, settings, now, [laowang, canteen, starter]);
assert.ok(settled.options.every((o) => o.origin !== "starter"));
assert.deepEqual(settled.options.map((o) => o.name), withMenus.options.map((o) => o.name));
// One own record only: starter rows join, still ordered by 分/g (鸡蛋 1 个 9.2 first).
const oneRecord = [meal({ ts: at(-1, 12), meal_name: "食堂鸡腿饭", merchant: "二食堂", amount_usd: 12, protein_low_g: 20, protein_high_g: 30 })];
const cold = buildNextMeal(oneRecord, [], [], settings, now, [starter]);
assert.equal(cold.options[0].name, "鸡蛋 1 个");
assert.equal(cold.options[0].origin, "starter");
assert.ok(cold.options.some((o) => o.name === "食堂鸡腿饭"));
console.log("  ok - starter list fills in only while the user's own rows are fewer than three");

console.log("\nnext-meal tests passed");
