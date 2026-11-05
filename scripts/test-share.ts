// Offline tests for the share-link codec and the starter list. Run: npx tsx scripts/test-share.ts
import assert from "node:assert/strict";
import { decodeMenus, encodeMenus, payloadFromHash, shareUrl } from "../lib/menu-share";
import { rankMenu, type MenuItem, type SavedMenu } from "../lib/menu-rank";
import { starterMenu, STARTER_ID } from "../lib/starter";
import { buildNextMeal } from "../lib/next-meal";
import { resolveSources, sourceTotals } from "../lib/estimate/menu";
import starterData from "../data/starter.json";

const dish = (id: string, name: string, price: number | null, pl: number, ph: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id, name, price, kcal_low: 100, kcal_high: 200, protein_low_g: pl, protein_high_g: ph,
  confidence: "medium", basis: "按蛋白来源算:鸡蛋×1(食材表,未逐行核实)", source: "ingredient_table", ...extra,
});
const laowang: SavedMenu = {
  id: "m1", name: "老王快餐", ts: 1793800000000,
  items: [dish("0", "卤蛋", 2, 5, 8), dish("1", "黄焖鸡米饭(小份)", 16, 25, 41), dish("2", "米饭", 1, 4, 6, { side: true }),
    dish("3", "招牌套餐", 18, 15, 30, { source: "text_estimate", confidence: "low" }), dish("4", "每日例汤", null, 2, 8)],
};

async function main() {
  // round trip
  const payload = await encodeMenus([laowang]);
  assert.ok(/^[zj][A-Za-z0-9_-]+$/.test(payload));
  const back = await decodeMenus(payload);
  assert.ok(back && back.length === 1);
  const m = back![0];
  assert.deepEqual([m.name, m.scanned_ts, m.items.length], ["老王快餐", 1793800000000, 5]);
  assert.deepEqual(m.items.map((i) => [i.name, i.price, i.protein_low_g, i.protein_high_g, i.source, i.confidence, !!i.side]), [
    ["卤蛋", 2, 5, 8, "ingredient_table", "medium", false],
    ["黄焖鸡米饭(小份)", 16, 25, 41, "ingredient_table", "medium", false],
    ["米饭", 1, 4, 6, "ingredient_table", "medium", true],
    ["招牌套餐", 18, 15, 30, "text_estimate", "low", false],
    ["每日例汤", null, 2, 8, "ingredient_table", "medium", false],
  ]);
  assert.ok(m.items[0].basis.includes("分享"));
  // the ranking of an imported menu equals the ranking of the original
  assert.deepEqual(rankMenu(m.items).ranked.map((r) => r.name), rankMenu(laowang.items).ranked.map((r) => r.name));
  console.log(`  ok - round trip keeps names, prices, ranges and the staple flag (${payload.length} chars for 5 dishes)`);

  // a 12-dish menu stays well under 1.5 k characters when deflated
  const big: SavedMenu = { id: "b", name: "二食堂 3 号窗口", ts: 1, items: Array.from({ length: 12 }, (_, i) => dish(String(i), `第${i}号套餐饭(大份)`, 10 + i, 15 + i, 25 + i)) };
  const bigPayload = await encodeMenus([big]);
  assert.ok(bigPayload.length < 1500, String(bigPayload.length));
  console.log(`  ok - 12 dishes fit in ${bigPayload.length} characters`);

  // url helpers
  const url = shareUrl("https://protein-wallet.vercel.app", payload);
  assert.equal(payloadFromHash(new URL(url).hash), payload);
  assert.equal(payloadFromHash("#other=1"), null);
  console.log("  ok - link carries the payload in the hash");

  // untrusted input: garbage, wrong version, bad numbers, oversized
  const j = (o: unknown) => "j" + Buffer.from(JSON.stringify(o)).toString("base64url");
  assert.equal(await decodeMenus(""), null);
  assert.equal(await decodeMenus("z!!!not-base64"), null);
  assert.equal(await decodeMenus("zAAAA"), null); // not a deflate stream
  assert.equal(await decodeMenus(j({ v: 2, m: [] })), null);
  assert.equal(await decodeMenus(j({ v: 1, m: [{ n: "x", t: 1, d: [["鸡", -3, 5, 8, 1, 2, 1, "i", 0]] }] })), null); // negative price
  assert.equal(await decodeMenus(j({ v: 1, m: [{ n: "x", t: 1, d: [["鸡", 3, 9, 8, 1, 2, 1, "i", 0]] }] })), null); // low > high
  assert.equal(await decodeMenus(j({ v: 1, m: [{ n: "x", t: 1, d: [["鸡", 3, 5, 9999, 1, 2, 1, "i", 0]] }] })), null); // absurd protein
  assert.equal(await decodeMenus(j({ v: 1, m: [{ n: "", t: 1, d: [["鸡", 3, 5, 8, 1, 2, 1, "i", 0]] }] })), null); // no place name
  assert.equal(await decodeMenus("j" + "A".repeat(70_000)), null); // oversized
  // "high" or unknown fields from a stranger are capped / downgraded, never trusted
  const odd = await decodeMenus(j({ v: 1, m: [{ n: "x", t: 1, d: [["鸡", 3, 5, 8, 1, 2, 2, "official_table", 7]] }] }));
  assert.deepEqual([odd![0].items[0].confidence, odd![0].items[0].source, odd![0].items[0].side], ["medium", "text_estimate", undefined]);
  // limits: at most 12 places and 40 dishes each survive
  const many = await decodeMenus(j({ v: 1, m: Array.from({ length: 20 }, (_, k) => ({ n: `店${k}`, t: 1, d: Array.from({ length: 60 }, (_, i) => [`菜${i}`, 5, 5, 8, 1, 2, 1, "i", 0]) })) }));
  assert.deepEqual([many!.length, many![0].items.length], [12, 40]);
  console.log("  ok - malformed, oversized or implausible links are rejected; stranger data is capped");

  // ---- starter list ----
  const starter = starterMenu(1000);
  assert.equal(starter.id, STARTER_ID);
  assert.ok(starter.starter && starter.items.length === starterData.items.length);
  // every starter protein number equals the ingredient-table arithmetic it claims
  for (const it of starterData.items) {
    const refs = it.from.split("+").map((p) => { const [name, qty] = p.trim().split("×"); return { name, qty: Number(qty) }; });
    const r = resolveSources(refs);
    assert.equal(r.unresolved.length, 0, it.name);
    assert.ok(Math.abs(sourceTotals(r).protein_g - it.protein_g) < 0.01, it.name);
  }
  // 鸡蛋 ¥0.6 / 6.5 g = 9.2 分/g; 生鸡胸肉 ¥6.8 / 56 g = 12.1; ranked cheapest first
  const ranked = rankMenu(starter.items).ranked;
  assert.deepEqual(ranked.slice(0, 3).map((r) => r.name), ["鸡蛋 1 个", "北豆腐 1 块(约 400 g)", "生鸡胸肉 1 块(约 250 g)"]);
  assert.deepEqual([ranked[0].protein_low_g, ranked[0].protein_high_g, ranked[0].cpg.toFixed(1)], [6, 7, "9.2"]);
  assert.ok(starter.items.every((i) => i.basis.includes("参考价") && i.confidence === "medium"));
  // a brand-new user (no records, only the starter) gets a list at once
  const nm = buildNextMeal([], [], [], { protein_target_g: 100, weekly_budget_usd: 140, created_at: 0 }, Date.UTC(2026, 10, 4, 12), [starter]);
  assert.equal(nm.state, "ok");
  assert.ok(nm.options.length >= 3 && nm.options[0].name === "鸡蛋 1 个");
  console.log("  ok - starter list: numbers match the ingredient table, new users get a list on day one");

  console.log("\nshare + starter tests passed");
}
main().catch((e) => { console.error(e); process.exit(1); });
