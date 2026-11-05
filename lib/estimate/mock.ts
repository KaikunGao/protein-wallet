import type { EstimateInput, ModelOutput, Portion } from "./schema";

const PORTION: Portion = { unit: "份", assumed: 1, unsure: false };

// Dev-only canned model outputs (ESTIMATE_MOCK=1) so the UI flow can be exercised
// without an API key. Goes through the same postProcess as real responses.
export function mockModelOutput(input: EstimateInput): ModelOutput {
  if (input.type === "grocery") {
    return {
      error: null,
      merchant: "盒马",
      total_usd: 68.5,
      items: [],
      grocery_ingredients: ["鸡胸肉 1kg", "鸡蛋 30 个", "纯牛奶 1L", "西兰花", "大米"],
    };
  }
  if (input.type === "receipt") {
    // 外卖订单截图: item names + prices are structured, nutrition is still estimated.
    return {
      error: null,
      merchant: "美团外卖 · 黄焖鸡米饭",
      total_usd: 22,
      items: [
        {
          meal_name: "黄焖鸡米饭(中份)",
          amount_usd: 19,
          chain_match: null,
          dining_match: null,
          kcal_low: 700, kcal_high: 950, protein_low_g: 28, protein_high_g: 40,
          confidence: "medium", basis: "外卖订单菜名 + 常见份量估算",
          portion: PORTION,
        },
        {
          meal_name: "冰红茶",
          amount_usd: 3,
          chain_match: null,
          dining_match: null,
          kcal_low: 90, kcal_high: 130, protein_low_g: 0, protein_high_g: 1,
          confidence: "medium", basis: "瓶装饮料,按常见规格估算",
          portion: PORTION,
        },
      ],
      grocery_ingredients: null,
    };
  }
  if (input.type === "photo" && input.dining_hall) {
    // Dining-hall plate: two menu items the code resolves against the snapshot.
    return {
      error: null,
      merchant: "Baker",
      total_usd: null,
      items: [
        {
          meal_name: "炒蛋",
          amount_usd: null,
          chain_match: null,
          dining_match: { hall: input.dining_hall, items: [{ name: "Scrambled Eggs", qty: 2 }] },
          kcal_low: 300, kcal_high: 500, protein_low_g: 20, protein_high_g: 32,
          confidence: "medium", basis: "食堂菜品库:炒蛋两份",
          portion: PORTION,
        },
        {
          meal_name: "培根",
          amount_usd: null,
          chain_match: null,
          dining_match: { hall: input.dining_hall, items: [{ name: "Bacon", qty: 1 }] },
          kcal_low: 100, kcal_high: 200, protein_low_g: 8, protein_high_g: 14,
          confidence: "medium", basis: "食堂菜品库:培根一份(3 片)",
          portion: PORTION,
        },
      ],
      grocery_ingredients: null,
    };
  }
  if (input.type === "photo") {
    return {
      error: null,
      merchant: null,
      total_usd: null,
      items: [
        {
          meal_name: "番茄炒蛋盖饭",
          amount_usd: null,
          chain_match: null,
          dining_match: null,
          kcal_low: 550, kcal_high: 850, protein_low_g: 18, protein_high_g: 30,
          confidence: "low", basis: "家常菜目测估算,份量约一盘",
          portion: PORTION,
        },
      ],
      grocery_ingredients: null,
    };
  }
  // text: one item per segment. Segments are split on 、,，;；/ newline, so a 日结
  // sentence ("早饭鸡蛋牛奶 5 元、午饭食堂鸡腿饭 12 元、一勺蛋白粉") becomes three items,
  // while "食堂红烧鸡腿 + 米饭 12 元" stays one. Mirrors prompt rule 4 / 日结模式.
  const AMOUNT = /[$¥]?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)?/;
  const segments = input.content.split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  const items = (segments.length ? segments : [input.content]).map((seg) => {
    const m = seg.match(AMOUNT);
    const amount = m ? Number(m[1]) : null;
    const lower = seg.toLowerCase();
    const name = seg.replace(new RegExp(AMOUNT.source, "g"), "").trim().slice(0, 20);
    if (lower.includes("麦当劳") || lower.includes("麦辣")) {
      // Chain name without chain_match: postProcess keeps it as a text estimate, never 官方.
      return {
        meal_name: "麦辣鸡腿堡",
        amount_usd: amount,
        chain_match: null,
        dining_match: null,
        kcal_low: 480, kcal_high: 560, protein_low_g: 18, protein_high_g: 24,
        confidence: "medium" as const, basis: "参考数据:麦当劳中国营养信息,待逐行核实",
        portion: PORTION,
      };
    }
    if (lower.includes("蛋白粉") || /一勺粉|勺粉/.test(lower)) {
      return {
        meal_name: "蛋白粉 1 勺",
        amount_usd: amount,
        chain_match: null,
        dining_match: null,
        kcal_low: 100, kcal_high: 130, protein_low_g: 20, protein_high_g: 27,
        confidence: "medium" as const, basis: "按一勺乳清蛋白粉(约 30 g)估算",
        portion: { unit: "勺", assumed: 1, unsure: false },
      };
    }
    return {
      meal_name: name || "一餐",
      amount_usd: amount,
      chain_match: null,
      dining_match: null,
      kcal_low: 500, kcal_high: 800, protein_low_g: 25, protein_high_g: 40,
      confidence: "medium" as const, basis: "按文字描述估算(mock)",
      portion: PORTION,
    };
  });
  const priced = items.filter((i) => i.amount_usd != null);
  const merchant = items.length === 1 && items[0].meal_name === "麦辣鸡腿堡" ? "麦当劳" : null;
  return {
    error: null,
    merchant,
    total_usd: priced.length ? priced.reduce((a, i) => a + (i.amount_usd ?? 0), 0) : null,
    items,
    grocery_ingredients: null,
  };
}
