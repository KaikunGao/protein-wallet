import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Confidence, Source } from "../types";
import { findChain, officialTotals, resolveComponents } from "./chains";
import { diningTotals, findHall, resolveDiningItems } from "./dining";
import { systemBlocks, userContent } from "./prompt";
import {
  ModelOutputSchema,
  type EstimateInput,
  type EstimateItem,
  type EstimateResponse,
  type ModelOutput,
} from "./schema";

// DECISION: model/effort are env-overridable so the eval loop can compare settings
// without code changes. Default is the current Opus at medium effort (fast enough
// for the 10-second record goal, still careful on vision).
export const ESTIMATE_MODEL = process.env.ESTIMATE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.ESTIMATE_EFFORT ?? "medium") as "low" | "medium" | "high";

// Minimum relative width (high-low)/mid per confidence. Narrower outputs are widened
// symmetrically so a "high" label can never hide a fake-precise range.
const MIN_REL_WIDTH: Record<Confidence, number> = { high: 0.15, medium: 0.3, low: 0.5 };
// Official-table numbers are exact per listed serving; ±10% covers portioning variance
// and keeps high-confidence width at 20% (< 30% eval target).
const OFFICIAL_SPREAD = 0.1;
// Chain rows entered from memory / only spot-checked: same arithmetic, but ±15% and
// "medium" so a number nobody has checked can never wear the 官方数据 badge.
const REFERENCE_SPREAD = 0.15;
// Dining-hall menu: per-portion numbers are official, the portion count is the
// model's visual guess, so ±20% and "medium".
const DINING_SPREAD = 0.2;

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
function minConf(a: Confidence, b: Confidence): Confidence {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

export function enforceRange(
  low: number,
  high: number,
  conf: Confidence,
): [number, number] {
  let l = Math.max(0, Number.isFinite(low) ? low : 0);
  let h = Math.max(0, Number.isFinite(high) ? high : 0);
  if (l > h) [l, h] = [h, l];
  const mid = (l + h) / 2;
  if (mid <= 0) return [0, Math.max(1, Math.round(h))];
  const min = MIN_REL_WIDTH[conf];
  if ((h - l) / mid < min) {
    l = mid * (1 - min / 2);
    h = mid * (1 + min / 2);
  }
  let rl = Math.round(l);
  let rh = Math.round(h);
  // Rounding can collapse small ranges (e.g. 3.6–4.4 -> 4–4); never emit a point value.
  if (rl === rh) {
    rl = Math.floor(l);
    rh = Math.ceil(h);
    if (rl === rh) rh = rl + 1;
  }
  return [rl, rh];
}

/** Deterministic post-processing: official-table arithmetic, confidence policy, guards. */
export function postProcess(out: ModelOutput, input: EstimateInput): EstimateResponse {
  const merchantChain = findChain(out.merchant);
  const merchant = merchantChain?.merchant ?? (out.merchant?.trim() || null);
  // Guard: never report a price the input could not contain.
  const textHasNumber = input.type !== "text" || /\d/.test(input.content);
  const total_usd = textHasNumber && out.total_usd != null && out.total_usd >= 0 ? out.total_usd : null;

  if (input.type === "grocery") {
    const ingredients = (out.grocery_ingredients ?? []).map((s) => s.trim()).filter(Boolean);
    if (ingredients.length === 0 && total_usd == null) {
      return { ok: false, error: out.error || "没识别出小票内容,请重拍或手动输入", retryable: true };
    }
    return { ok: true, kind: "grocery", merchant, total_usd, ingredients };
  }

  if (out.items.length === 0) {
    return { ok: false, error: out.error || "没识别出食物,请重拍或改用文字输入", retryable: true };
  }

  const fallbackSource: Source = input.type === "text" ? "text_estimate" : "visual_estimate";
  const hall = input.type === "photo" || input.type === "text" ? findHall(input.dining_hall) : null;
  const items: EstimateItem[] = out.items.map((it) => {
    const amount_usd = textHasNumber && it.amount_usd != null && it.amount_usd >= 0 ? it.amount_usd : null;
    const chain = it.chain_match ? (findChain(it.chain_match.merchant) ?? merchantChain) : null;
    const itemMerchant = chain?.merchant ?? (hall && it.dining_match ? hall.short : merchant);
    let diningMiss = false;

    if (chain && it.chain_match && it.chain_match.components.length > 0) {
      const r = resolveComponents(chain, it.chain_match.components);
      if (r.unresolved.length === 0) {
        const t = officialTotals(r);
        const comps = r.resolved.map(({ item, qty }) => (qty !== 1 ? `${item.name}×${qty}` : item.name));
        const official = chain.data_status === "official";
        const spread = official ? OFFICIAL_SPREAD : REFERENCE_SPREAD;
        const conf: Confidence = official ? "high" : "medium";
        const [kl, kh] = enforceRange(t.kcal * (1 - spread), t.kcal * (1 + spread), conf);
        const [pl, ph] = enforceRange(t.protein_g * (1 - spread), t.protein_g * (1 + spread), conf);
        return {
          meal_name: it.meal_name.trim() || comps[0],
          merchant: itemMerchant,
          amount_usd,
          kcal_low: kl,
          kcal_high: kh,
          protein_low_g: pl,
          protein_high_g: ph,
          confidence: conf,
          basis: official
            ? `${chain.merchant} 官方营养表:${comps.join(" + ")}`
            : `${chain.merchant} 参考营养表(未逐行核实):${comps.join(" + ")}`,
          source: official ? "official_table" : "reference_table",
          matched_components: comps,
          portion: it.portion ?? null,
        };
      }
    }

    // Tier 2: dining-hall menu. Only when the request carried a hall and the model
    // mapped this item onto menu rows. Per-portion numbers are official; qty is guessed.
    if (hall && it.dining_match && it.dining_match.items.length > 0) {
      const r = resolveDiningItems(it.dining_match.items);
      if (r.unresolved.length === 0) {
        const t = diningTotals(r);
        const comps = r.resolved.map(({ entry, qty }) => (qty !== 1 ? `${entry.display}×${qty}` : entry.display));
        const [kl, kh] = enforceRange(t.kcal[0] * (1 - DINING_SPREAD), t.kcal[1] * (1 + DINING_SPREAD), "medium");
        const [pl, ph] = enforceRange(t.protein_g[0] * (1 - DINING_SPREAD), t.protein_g[1] * (1 + DINING_SPREAD), "medium");
        return {
          meal_name: it.meal_name.trim() || comps[0],
          merchant: hall.short,
          amount_usd,
          kcal_low: kl,
          kcal_high: kh,
          protein_low_g: pl,
          protein_high_g: ph,
          confidence: "medium",
          basis: `${hall.short} 食堂菜品库(官方每份数据,份数目测):${comps.join(" + ")}`,
          source: "dining_menu",
          matched_components: comps,
          portion: it.portion ?? null,
        };
      }
      diningMiss = true;
    }

    // No (or incomplete) official match: the model's own range, with confidence capped.
    // DECISION: photo without a chain match is forced to "low" (PRD); text/receipt
    // name-based estimates may stay "medium" at most.
    const cap: Confidence = input.type === "photo" ? "low" : "medium";
    const confidence = minConf(it.confidence, cap);
    const [kl, kh] = enforceRange(it.kcal_low, it.kcal_high, confidence);
    const [pl, ph] = enforceRange(it.protein_low_g, it.protein_high_g, confidence);
    const basis =
      it.chain_match && chain
        ? `${it.basis.trim()}(未能匹配官方条目,按估算)`
        : diningMiss
          ? `${it.basis.trim() || "目测估算"}(菜品库里没有,按目测)`
          : it.basis.trim() || (input.type === "text" ? "按描述估算" : "目测估算");
    return {
      meal_name: it.meal_name.trim() || "未命名餐食",
      merchant: itemMerchant,
      amount_usd,
      kcal_low: kl,
      kcal_high: kh,
      protein_low_g: pl,
      protein_high_g: ph,
      confidence,
      basis,
      source: fallbackSource,
      portion: it.portion ?? null,
    };
  });

  return { ok: true, kind: "meal", merchant, total_usd, items };
}

/** One model call. Returns null when the response did not parse against the schema. */
export async function callModel(
  input: EstimateInput,
  client: Anthropic,
): Promise<{ output: ModelOutput | null; refusal?: string }> {
  const res = await client.messages.parse({
    model: ESTIMATE_MODEL,
    max_tokens: 8000,
    system: systemBlocks(input),
    messages: [{ role: "user", content: userContent(input) }],
    output_config: { effort: EFFORT, format: zodOutputFormat(ModelOutputSchema) },
  });
  if (res.stop_reason === "refusal") {
    return { output: null, refusal: res.stop_details?.explanation ?? "模型拒绝了这次请求" };
  }
  return { output: res.parsed_output ?? null };
}

let cachedClient: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}

/**
 * Shared estimate entry point used by the API route and the eval script.
 * Schema failure is retried once (PRD); API errors are mapped to friendly messages.
 */
export async function estimate(
  input: EstimateInput,
  deps: { client?: Anthropic } = {},
): Promise<EstimateResponse> {
  const client = deps.client ?? defaultClient();
  try {
    let r = await callModel(input, client);
    if (r.refusal) return { ok: false, error: r.refusal, retryable: false };
    if (!r.output) r = await callModel(input, client);
    if (r.refusal) return { ok: false, error: r.refusal, retryable: false };
    if (!r.output) return { ok: false, error: "模型返回格式异常,请再试一次", retryable: true };
    return postProcess(r.output, input);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "服务端 API key 无效", retryable: false };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "请求太频繁,稍等几秒再试", retryable: true };
    }
    if (e instanceof Anthropic.BadRequestError) {
      return { ok: false, error: `请求被拒绝:${e.message}`, retryable: false };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: "网络连不上模型服务,请检查网络后重试", retryable: true };
    }
    if (e instanceof Anthropic.APIError) {
      return { ok: false, error: `模型服务错误 (${e.status})`, retryable: true };
    }
    throw e;
  }
}
