import type { EstimateInput, ModelOutput, Portion } from "./schema";

const PORTION: Portion = { unit: "份", assumed: 1, unsure: false };

// Dev-only canned model outputs (ESTIMATE_MOCK=1) so the UI flow can be exercised
// without an API key. Goes through the same postProcess as real responses.
export function mockModelOutput(input: EstimateInput): ModelOutput {
  if (input.type === "grocery") {
    return {
      error: null,
      merchant: "Trader Joe's",
      total_usd: 34.2,
      items: [],
      grocery_ingredients: ["鸡胸肉 2lb", "鸡蛋 12 个", "希腊酸奶", "西兰花", "米"],
    };
  }
  if (input.type === "receipt") {
    return {
      error: null,
      merchant: "Chipotle",
      total_usd: 24.6,
      items: [
        {
          meal_name: "鸡肉碗",
          amount_usd: 11.25,
          chain_match: {
            merchant: "Chipotle",
            components: [
              { name: "Chicken", qty: 1 },
              { name: "White Rice", qty: 1 },
              { name: "Black Beans", qty: 1 },
              { name: "Fresh Tomato Salsa", qty: 1 },
              { name: "Cheese", qty: 1 },
            ],
          },
          dining_match: null,
          kcal_low: 600, kcal_high: 720, protein_low_g: 46, protein_high_g: 56,
          confidence: "high", basis: "Chipotle 官方营养表",
          portion: PORTION,
        },
        {
          meal_name: "薯片配牛油果酱",
          amount_usd: 5.2,
          chain_match: { merchant: "Chipotle", components: [{ name: "Chips & Guacamole", qty: 1 }] },
          dining_match: null,
          kcal_low: 700, kcal_high: 840, protein_low_g: 8, protein_high_g: 10,
          confidence: "high", basis: "Chipotle 官方营养表",
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
  // text
  const m = input.content.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  const amount = m ? Number(m[1]) : null;
  const lower = input.content.toLowerCase();
  if (lower.includes("chipotle")) {
    return {
      error: null,
      merchant: "Chipotle",
      total_usd: amount,
      items: [
        {
          meal_name: "鸡肉碗",
          amount_usd: amount,
          chain_match: {
            merchant: "Chipotle",
            components: [
              { name: "Chicken", qty: 1 },
              { name: "White Rice", qty: 1 },
              { name: "Black Beans", qty: 1 },
              { name: "Fresh Tomato Salsa", qty: 1 },
              { name: "Cheese", qty: 1 },
              { name: "Romaine Lettuce", qty: 1 },
            ],
          },
          dining_match: null,
          kcal_low: 600, kcal_high: 720, protein_low_g: 46, protein_high_g: 56,
          confidence: "high", basis: "Chipotle 官方营养表,按常见配料估算",
          portion: PORTION,
        },
      ],
      grocery_ingredients: null,
    };
  }
  return {
    error: null,
    merchant: null,
    total_usd: amount,
    items: [
      {
        meal_name: input.content.replace(/\$?\s*\d+(?:\.\d{1,2})?/g, "").trim().slice(0, 20) || "一餐",
        amount_usd: amount,
        chain_match: null,
        dining_match: null,
        kcal_low: 500, kcal_high: 800, protein_low_g: 25, protein_high_g: 40,
        confidence: "medium", basis: "按文字描述估算(mock)",
          portion: PORTION,
      },
    ],
    grocery_ingredients: null,
  };
}
