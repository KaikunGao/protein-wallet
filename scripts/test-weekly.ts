// Hand-calculated check of the weekly report (PRD 3.3 acceptance). Run: npx tsx scripts/test-weekly.ts
import assert from "node:assert/strict";
import { buildWeeklyReport, rankByCentsPerGram } from "../lib/weekly";
import { startOfWeek, addDays } from "../lib/dates";
import type { Meal, Settings } from "../lib/types";

const settings: Settings = { protein_target_g: 90, weekly_budget_usd: 100, created_at: 0 };
const ws = startOfWeek(new Date(2026, 9, 7)); // Mon 2026-10-05
const at = (day: number, hour: number) => addDays(ws, day).getTime() + hour * 3600e3;

let n = 0;
const meal = (p: Partial<Meal> & { ts: number; meal_name: string }): Meal => ({
  id: String(++n), kind: "meal", input_type: "text", merchant: null, amount_usd: null,
  kcal_low: 0, kcal_high: 0, protein_low_g: 0, protein_high_g: 0, confidence: "medium",
  basis: "", source: "text_estimate", user_corrected: false, ...p,
});

const week: Meal[] = [
  meal({ ts: at(0, 12), meal_name: "鸡肉碗", merchant: "Chipotle", amount_usd: 11.25, protein_low_g: 46, protein_high_g: 56 }),
  meal({ ts: at(0, 19), meal_name: "食堂烤鸡胸", amount_usd: 12, protein_low_g: 35, protein_high_g: 50 }),
  meal({ ts: at(1, 19), meal_name: "中餐外卖", merchant: "Lao Sze Chuan", amount_usd: 15, protein_low_g: 20, protein_high_g: 35 }),
  meal({ ts: at(2, 12), meal_name: "鸡肉碗", merchant: "Chipotle", amount_usd: 11.25, protein_low_g: 46, protein_high_g: 56 }),
  meal({ ts: at(2, 13), meal_name: "免费披萨", amount_usd: null, protein_low_g: 10, protein_high_g: 20 }), // no amount -> not ranked
  meal({ ts: at(3, 10), meal_name: "Trader Joe's 买菜", kind: "grocery", input_type: "grocery", amount_usd: 34.2,
    kcal_low: null, kcal_high: null, protein_low_g: null, protein_high_g: null, confidence: null, source: null }),
];
const prev: Meal[] = [
  meal({ ts: at(-7, 12), meal_name: "鸡肉碗", merchant: "Chipotle", amount_usd: 11.25, protein_low_g: 46, protein_high_g: 56 }),
  meal({ ts: at(-7, 19), meal_name: "牛排", amount_usd: 20, protein_low_g: 40, protein_high_g: 60 }),
];

const r = buildWeeklyReport(week, prev, settings, ws);

// Hand calc:
//  鸡肉碗 x2: $22.50 / 102 g = 22.06 ¢/g ; 食堂烤鸡胸: $12 / 42.5 g = 28.24 ; 中餐外卖: $15 / 27.5 g = 54.55
const rank = rankByCentsPerGram(week);
assert.deepEqual(rank.map((x) => x.name), ["鸡肉碗", "食堂烤鸡胸", "中餐外卖"]);
assert.deepEqual(rank.map((x) => x.cpg.toFixed(2)), ["22.06", "28.24", "54.55"]);
assert.equal(rank[0].times, 2);
console.log("  ok - ranking matches hand calculation");

// spend includes grocery: 11.25*2 + 12 + 15 + 34.2 = 83.7
assert.equal(Math.round(r.spend * 100) / 100, 83.7);
console.log("  ok - spend includes grocery rows");

// days: Mon 51+42.5=93.5 (met), Tue 27.5, Wed 51+15=66, Thu grocery only -> no nutrition
assert.equal(r.daysRecorded, 3);
assert.equal(r.daysMet, 1);
assert.deepEqual(r.days.map((d) => (d.proteinMid == null ? null : Math.round(d.proteinMid * 10) / 10)), [93.5, 27.5, 66, null, null, null, null]);
console.log("  ok - protein days");

// avg cpg = (22.5+12+15)*100 / (102+42.5+27.5) = 4950/172 = 28.78
assert.equal(r.avgCpg!.toFixed(2), "28.78");
console.log("  ok - average ¢/g");

// delta: prev spend 31.25, prev met days: Mon 51+50=101 >= 90 -> 1/1
assert.equal(r.delta, "比上周多花 $52.45,蛋白达标天数 1/1 → 1/3。");
const r2 = buildWeeklyReport(week, [], settings, ws);
assert.equal(r2.delta, "上周没有记录,从这周开始有对比。");
console.log("  ok - delta sentence");

console.log("\nweekly report tests passed");

import { fmtMoney, cpgUnit } from "../lib/money";
assert.equal(fmtMoney(12.5, "CNY"), "¥12.50");
assert.equal(fmtMoney(12, "USD"), "$12");
assert.equal(cpgUnit("CNY"), "分/g");
assert.equal(cpgUnit(), "¢/g");
console.log("  ok - currency formatting");
