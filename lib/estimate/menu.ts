// 拍菜单做决策 (PRD F0-2), server side: the tables, the model call and the deterministic
// post-processing. The model does two things only: read dish names + prices off the menu,
// and split each dish into protein sources. Code looks the sources up in
// data/ingredients.json and does the arithmetic; ranking happens in lib/menu-rank.ts.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import ingredientsData from "../../data/ingredients.json";
import streetData from "../../data/street.json";
import type { MenuItem, MenuResponse } from "../menu-rank";
import type { Confidence } from "../types";
import { ESTIMATE_MODEL, enforceRange, mapApiError } from "./estimate";
import { ConfidenceSchema } from "./schema";

export const MENU_PROMPT_VERSION = "menu-v1";
const EFFORT = (process.env.ESTIMATE_EFFORT ?? "medium") as "low" | "medium" | "high";
export const MENU_MAX_DISHES = 40;
// Table values are per typical unit and unverified, and the menu shows no portion, so the
// protein range is ±25% and the confidence is capped at medium.
const TABLE_SPREAD = 0.25;

// ---------- tables ----------

export interface Ingredient {
  name: string;
  aliases: string[];
  unit: string;
  grams: number;
  protein_g: number;
  kcal: number;
  kind: "protein" | "staple" | "veg";
}
export interface SourceRef { name: string; qty: number }
export interface Recipe { name: string; aliases: string[]; base: SourceRef[]; note?: string }
interface Addon { keywords: string[]; name: string; qty: number }

export const INGREDIENTS: Ingredient[] = ingredientsData.items as Ingredient[];
export const RECIPES: Recipe[] = streetData.recipes as Recipe[];
const ADDONS: Addon[] = streetData.addons as Addon[];

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s·・()()【】\[\]]/g, "").trim();
}

/** Exact match on an ingredient's name or alias. */
export function findIngredient(name: string): Ingredient | null {
  const n = norm(name);
  if (!n) return null;
  return INGREDIENTS.find((i) => norm(i.name) === n || i.aliases.some((a) => norm(a) === n)) ?? null;
}

export interface ResolvedSources {
  resolved: { item: Ingredient; qty: number }[];
  unresolved: string[];
}

export function resolveSources(list: SourceRef[]): ResolvedSources {
  const out: ResolvedSources = { resolved: [], unresolved: [] };
  for (const s of list) {
    const item = findIngredient(s.name);
    const qty = Number.isFinite(s.qty) && s.qty > 0 ? s.qty : 1;
    if (item) out.resolved.push({ item, qty });
    else out.unresolved.push(s.name);
  }
  return out;
}

export function sourceTotals(r: ResolvedSources): { protein_g: number; kcal: number } {
  return r.resolved.reduce(
    (acc, { item, qty }) => ({ protein_g: acc.protein_g + item.protein_g * qty, kcal: acc.kcal + item.kcal * qty }),
    { protein_g: 0, kcal: 0 },
  );
}

/** Standard street-food recipe whose name or alias appears in the dish name (longest match wins). */
export function findRecipe(dishName: string): Recipe | null {
  const n = norm(dishName);
  let best: { r: Recipe; len: number } | null = null;
  for (const r of RECIPES) {
    for (const a of [r.name, ...r.aliases]) {
      const k = norm(a);
      if (k && n.includes(k) && (!best || k.length > best.len)) best = { r, len: k.length };
    }
  }
  return best?.r ?? null;
}

/** Recipe base plus the add-ons named in the dish ("加蛋", "加肠" …). */
export function recipeSources(dishName: string, recipe: Recipe): SourceRef[] {
  const n = norm(dishName);
  const out = recipe.base.map((b) => ({ ...b }));
  for (const a of ADDONS) {
    if (a.keywords.some((k) => n.includes(norm(k)))) {
      const hit = out.find((o) => o.name === a.name);
      if (hit) hit.qty += a.qty;
      else out.push({ name: a.name, qty: a.qty });
    }
  }
  return out;
}

/**
 * Crude protein sources from a dish name alone: a street recipe if one matches, otherwise
 * every ingredient whose name or alias appears in the name (longest first, no overlaps).
 * Used by the dev mock; the real flow only falls back to the recipe half of this.
 */
export function guessSources(dishName: string): SourceRef[] {
  const recipe = findRecipe(dishName);
  if (recipe) return recipeSources(dishName, recipe);
  const n = norm(dishName);
  const cands: { start: number; end: number; name: string }[] = [];
  for (const i of INGREDIENTS) {
    for (const a of [i.name, ...i.aliases]) {
      const k = norm(a);
      const at = k ? n.indexOf(k) : -1;
      if (at >= 0) cands.push({ start: at, end: at + k.length, name: i.name });
    }
  }
  cands.sort((a, b) => b.end - b.start - (a.end - a.start));
  const taken: { start: number; end: number }[] = [];
  const names: string[] = [];
  for (const c of cands) {
    if (taken.some((t) => c.start < t.end && t.start < c.end)) continue;
    taken.push(c);
    if (!names.includes(c.name)) names.push(c.name);
    if (names.length >= 4) break;
  }
  return names.map((name) => ({ name, qty: 1 }));
}

// ---------- model contract ----------

export const MenuDishSchema = z.object({
  name: z.string(),
  price: z.number().nullable(), // 元; null when the menu does not show it
  protein_sources: z.array(z.object({ name: z.string(), qty: z.number() })),
  protein_low_g: z.number(),
  protein_high_g: z.number(),
  kcal_low: z.number(),
  kcal_high: z.number(),
  confidence: ConfidenceSchema,
  basis: z.string(),
});
export const MenuModelSchema = z.object({
  error: z.string().nullable(),
  merchant: z.string().nullable(),
  dishes: z.array(MenuDishSchema),
});
export type MenuModelOutput = z.infer<typeof MenuModelSchema>;

export const MenuInputSchema = z.object({
  type: z.enum(["photo", "text"]),
  // text: the typed menu; photo: base64 image (no data: prefix)
  content: z.string().min(1).max(8_000_000),
  media_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
});
export type MenuInput = z.infer<typeof MenuInputSchema>;

function tablesForPrompt(): string {
  const lines = ["## 食材表(name | 单位 | 每单位蛋白 g | 每单位 kcal;别名只帮你对应,输出一律用 name)"];
  for (const i of INGREDIENTS) {
    const alias = i.aliases.length ? ` | 别名:${i.aliases.join("、")}` : "";
    lines.push(`- ${i.name} | ${i.unit}(约 ${i.grams} g) | ${i.protein_g} | ${i.kcal}${alias}`);
  }
  lines.push("", "## 标准做法表(路边摊和小馆子的常见做法;加料另加)");
  for (const r of RECIPES) {
    const base = r.base.map((b) => `${b.name}×${b.qty}`).join(" + ");
    lines.push(`- ${r.name}${r.aliases.length ? `(${r.aliases.join("、")})` : ""} = ${base}${r.note ? `;${r.note}` : ""}`);
  }
  return lines.join("\n");
}

const RULES = `你是「蛋白钱包」的菜单解析器。用户是生活费有限、想增肌的国内大学生,在吃之前拍了一张菜单(食堂窗口价目牌、路边摊招牌、外卖店铺菜单截图),或者打了一段菜单文字。任务:读出每道菜的名字和价格,并把每道菜拆成蛋白来源。排序不归你管,代码会按每一块钱换多少克蛋白来排,所以不要挑选、不要推荐、不要省略你觉得不划算的菜。

## 输出
只返回符合给定 schema 的 JSON,不要任何解释文字。

## 规则
1. 只读菜单上有的。name 用菜单原文,可以去掉序号和装饰符号。price 填菜单上这道菜的价格(元,纯数字);看不清或菜单没写就填 null,绝不猜价格。有小/中/大多个规格的,每个规格单列一项,name 带上规格。套餐算一项。
2. protein_sources:列出这道菜一人份里的蛋白来源。name 必须用下方「食材表」里的 name 原文,qty 是该单位的数量,可以用小数。主食也要列(米饭、面条、馍)。标准的路边摊小吃按「标准做法表」拆,菜名里的加料(加蛋、加肠)另加。纯蔬菜的菜列「蔬菜」。食材表里找不到对应项的蛋白来源不要硬套,这道菜的 protein_sources 给空数组。饮料、纯甜品给空数组。
3. 同时给出你自己估的蛋白和热量区间(一人份)。永远是区间,low 明显小于 high。菜单上看不到份量,所以 confidence 最高 medium;菜名含糊的(「招牌套餐」「每日例汤」)填 low 并把区间拉宽。
4. basis 用一句中文说明你的假设,例如「按一只琵琶腿加一碗米饭」。
5. 最多 ${MENU_MAX_DISHES} 道,按菜单上的顺序。图片不是菜单、或看不清:error 填一句中文原因,dishes 留空,绝不编造。
6. merchant 填店名或窗口名,看不出来填 null。

`;

export function menuSystemBlocks(): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: RULES + tablesForPrompt(), cache_control: { type: "ephemeral" } }];
}

export function menuUserContent(input: MenuInput): Anthropic.ContentBlockParam[] {
  if (input.type === "text") {
    return [{ type: "text", text: `用户打出来的菜单(价格单位是元):\n${input.content}` }];
  }
  return [
    { type: "image", source: { type: "base64", media_type: input.media_type ?? "image/jpeg", data: input.content } },
    { type: "text", text: "这是用户吃之前拍的菜单。读出每道菜的名字和价格(元),并拆出蛋白来源。" },
  ];
}

// ---------- deterministic post-processing ----------

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
function cap(c: Confidence, max: Confidence): Confidence {
  return CONF_RANK[c] <= CONF_RANK[max] ? c : max;
}
function fmtComp(r: ResolvedSources): string[] {
  return r.resolved.map(({ item, qty }) => `${item.name}×${Math.round(qty * 100) / 100}`);
}

export function postProcessMenu(out: MenuModelOutput, input: MenuInput): MenuResponse {
  if (out.dishes.length === 0) {
    return { ok: false, error: out.error || "没读出菜单,换个角度重拍,或者把菜单打出来", retryable: true };
  }
  // Guard: a typed menu without any digit cannot contain a price.
  const pricesPossible = input.type !== "text" || /\d/.test(input.content);
  const seen = new Set<string>();
  const items: MenuItem[] = [];
  for (const d of out.dishes) {
    const name = d.name.trim();
    if (!name) continue;
    const price = pricesPossible && d.price != null && Number.isFinite(d.price) && d.price > 0 ? d.price : null;
    const key = `${name}|${price ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Tier 1: the model's sources, all found in the ingredient table. Tier 2: a standard
    // street recipe matched by name. Otherwise the model's own range, capped at low.
    let table: ResolvedSources | null = null;
    let how = "";
    const fromModel = resolveSources(d.protein_sources);
    if (fromModel.resolved.length > 0 && fromModel.unresolved.length === 0) {
      table = fromModel;
      how = "按蛋白来源算";
    } else {
      const recipe = findRecipe(name);
      if (recipe) {
        table = resolveSources(recipeSources(name, recipe));
        how = `按「${recipe.name}」的常见做法算`;
      }
    }

    if (table && table.resolved.length > 0) {
      const t = sourceTotals(table);
      const [pl, ph] = enforceRange(t.protein_g * (1 - TABLE_SPREAD), t.protein_g * (1 + TABLE_SPREAD), "medium");
      // Oil and sauce are not in the table, so calories stay the model's estimate when it gave one.
      const modelKcal = d.kcal_high > 0;
      const [kl, kh] = modelKcal
        ? enforceRange(d.kcal_low, d.kcal_high, "medium")
        : enforceRange(t.kcal * 0.9, t.kcal * 1.5, "medium");
      const comps = fmtComp(table);
      items.push({
        id: String(items.length),
        name,
        price,
        kcal_low: kl,
        kcal_high: kh,
        protein_low_g: pl,
        protein_high_g: ph,
        confidence: "medium",
        basis: `${how}:${comps.join(" + ")}(食材表,未逐行核实;菜单上看不到份量)`,
        source: "ingredient_table",
        components: comps,
        // Plain rice, 凉皮, 清炒时蔬: cheap protein per yuan on paper, but not a protein dish.
        side: table.resolved.every(({ item }) => item.kind !== "protein"),
      });
    } else {
      const conf = cap(d.confidence, "low");
      const [pl, ph] = enforceRange(d.protein_low_g, d.protein_high_g, conf);
      const [kl, kh] = enforceRange(d.kcal_low, d.kcal_high, conf);
      items.push({
        id: String(items.length),
        name,
        price,
        kcal_low: kl,
        kcal_high: kh,
        protein_low_g: pl,
        protein_high_g: ph,
        confidence: conf,
        basis: `${d.basis.trim() || "按菜名估算"}(食材表里没有对应项,按菜名估)`,
        source: "text_estimate",
      });
    }
    if (items.length >= MENU_MAX_DISHES) break;
  }
  if (items.length === 0) {
    return { ok: false, error: "没读出菜名,换个角度重拍,或者把菜单打出来", retryable: true };
  }
  return { ok: true, merchant: out.merchant?.trim() || null, items };
}

// ---------- dev mock (ESTIMATE_MOCK=1) ----------

const MOCK_PHOTO_MENU: [string, number | null][] = [
  ["卤鸡腿饭", 12],
  ["番茄炒蛋盖饭", 8],
  ["牛肉面", 16],
  ["红烧肉盖饭", 13],
  ["麻婆豆腐盖饭", 9],
  ["清炒时蔬", 4],
  ["茶叶蛋", 1.5],
  ["可乐", 3],
];

export function mockMenuOutput(input: MenuInput): MenuModelOutput {
  const rows: [string, number | null][] =
    input.type === "photo"
      ? MOCK_PHOTO_MENU
      : input.content
          .split(/[、,，;；\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((seg) => {
            const m = seg.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块)?\s*$/);
            const name = seg.replace(/[¥¥]?\s*\d+(?:\.\d{1,2})?\s*(?:元|块)?\s*$/, "").trim();
            return [name || seg, m ? Number(m[1]) : null] as [string, number | null];
          });
  return {
    error: null,
    merchant: input.type === "photo" ? "二食堂 3 号窗口" : null,
    dishes: rows.map(([name, price]) => {
      const sources = guessSources(name);
      const t = sourceTotals(resolveSources(sources));
      const none = sources.length === 0;
      return {
        name,
        price,
        protein_sources: sources,
        protein_low_g: none ? 0 : t.protein_g * 0.7,
        protein_high_g: none ? 2 : t.protein_g * 1.3,
        kcal_low: none ? 80 : t.kcal * 0.9,
        kcal_high: none ? 200 : t.kcal * 1.5,
        confidence: "medium" as const,
        basis: none ? "看不出蛋白来源(mock)" : "按菜名对应的蛋白来源(mock)",
      };
    }),
  };
}

// ---------- model call ----------

let cachedClient: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

async function callMenuModel(input: MenuInput, client: Anthropic): Promise<{ output: MenuModelOutput | null; refusal?: string }> {
  const res = await client.messages.parse({
    model: ESTIMATE_MODEL,
    max_tokens: 8000,
    system: menuSystemBlocks(),
    messages: [{ role: "user", content: menuUserContent(input) }],
    output_config: { effort: EFFORT, format: zodOutputFormat(MenuModelSchema) },
  });
  if (res.stop_reason === "refusal") {
    return { output: null, refusal: res.stop_details?.explanation ?? "模型拒绝了这次请求" };
  }
  return { output: res.parsed_output ?? null };
}

/** One menu in, one parsed and table-checked dish list out. Schema failure is retried once. */
export async function parseMenu(input: MenuInput, deps: { client?: Anthropic } = {}): Promise<MenuResponse> {
  const client = deps.client ?? defaultClient();
  try {
    let r = await callMenuModel(input, client);
    if (r.refusal) return { ok: false, error: r.refusal, retryable: false };
    if (!r.output) r = await callMenuModel(input, client);
    if (r.refusal) return { ok: false, error: r.refusal, retryable: false };
    if (!r.output) return { ok: false, error: "模型返回格式异常,请再试一次", retryable: true };
    return postProcessMenu(r.output, input);
  } catch (e) {
    const mapped = mapApiError(e);
    if (mapped) return mapped;
    throw e;
  }
}
