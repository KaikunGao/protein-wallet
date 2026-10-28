import { z } from "zod";
import type { Confidence, Source } from "../types";

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

// ---- What the model returns (structured output) ----
// The model always fills its own range; `chain_match` lets the code replace
// that range with arithmetic over the official table (two-level strategy).
export const ModelItemSchema = z.object({
  meal_name: z.string(),
  amount_usd: z.number().nullable(),
  chain_match: z
    .object({
      merchant: z.string(),
      components: z.array(z.object({ name: z.string(), qty: z.number() })),
    })
    .nullable(),
  // Filled only when the request carries a dining_hall: which menu items are on
  // the plate and how many menu portions of each (fractions allowed).
  dining_match: z
    .object({
      hall: z.string(),
      items: z.array(z.object({ name: z.string(), qty: z.number() })),
    })
    .nullable(),
  kcal_low: z.number(),
  kcal_high: z.number(),
  protein_low_g: z.number(),
  protein_high_g: z.number(),
  confidence: ConfidenceSchema,
  basis: z.string(),
});

export const ModelOutputSchema = z.object({
  error: z.string().nullable(),
  merchant: z.string().nullable(),
  total_usd: z.number().nullable(),
  items: z.array(ModelItemSchema),
  grocery_ingredients: z.array(z.string()).nullable(),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type ModelItem = z.infer<typeof ModelItemSchema>;

// ---- API request ----
export const EstimateInputSchema = z.object({
  type: z.enum(["text", "photo", "receipt", "grocery"]),
  // text: the sentence; others: base64 image (no data: prefix), <= ~6 MB
  content: z.string().min(1).max(8_000_000),
  media_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  // Dining-hall context (photo/text only): hall slug from data/dining/uchicago/halls.json.
  dining_hall: z.string().max(64).optional(),
  // Currency the user records in; the amount_usd / total_usd fields carry this currency.
  currency: z.enum(["USD", "CNY"]).optional(),
});
export type EstimateInput = z.infer<typeof EstimateInputSchema>;

// ---- API response (shared with the client and the eval script) ----
export interface EstimateItem {
  meal_name: string;
  merchant: string | null;
  amount_usd: number | null;
  kcal_low: number;
  kcal_high: number;
  protein_low_g: number;
  protein_high_g: number;
  confidence: Confidence;
  basis: string;
  source: Source;
  matched_components?: string[];
}

export type EstimateResponse =
  | {
      ok: true;
      kind: "meal";
      merchant: string | null;
      total_usd: number | null;
      items: EstimateItem[];
    }
  | {
      ok: true;
      kind: "grocery";
      merchant: string | null;
      total_usd: number | null;
      ingredients: string[];
    }
  | { ok: false; error: string; retryable: boolean };
