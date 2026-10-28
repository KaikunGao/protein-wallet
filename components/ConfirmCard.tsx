"use client";

import { useState } from "react";
import ConfidenceBadge, { confidenceBorder } from "./ConfidenceBadge";
import type { EstimateResponse } from "@/lib/estimate/schema";
import { logEvent, newId } from "@/lib/db";
import { CURRENCIES, currencyOf, type Currency } from "@/lib/money";
import type { Confidence, InputType, Meal, Source } from "@/lib/types";

type OkResponse = Extract<EstimateResponse, { ok: true }>;

interface Draft {
  key: string;
  meal_name: string;
  merchant: string | null;
  amount: string; // keep as string while editing
  kcal_low: string;
  kcal_high: string;
  protein_low_g: string;
  protein_high_g: string;
  confidence: Confidence;
  basis: string;
  source: Source;
  corrected: boolean;
}

function toDrafts(r: OkResponse): Draft[] {
  if (r.kind !== "meal") return [];
  return r.items.map((it) => ({
    key: newId(),
    meal_name: it.meal_name,
    merchant: it.merchant,
    amount: it.amount_usd != null ? String(it.amount_usd) : "",
    kcal_low: String(it.kcal_low),
    kcal_high: String(it.kcal_high),
    protein_low_g: String(it.protein_low_g),
    protein_high_g: String(it.protein_high_g),
    confidence: it.confidence,
    basis: it.basis,
    source: it.source,
    corrected: false,
  }));
}

function num(s: string): number | null {
  const n = Number(s);
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
}

export default function ConfirmCard({
  result,
  inputType,
  defaultAmount,
  currency,
  onSave,
  onCancel,
}: {
  result: OkResponse;
  inputType: InputType;
  defaultAmount?: number | null;
  currency?: Currency;
  onSave: (meals: Meal[], meta: { corrected: boolean }) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(result));
  const [groceryAmount, setGroceryAmount] = useState(
    result.kind === "grocery" && result.total_usd != null ? String(result.total_usd) : "",
  );
  const [groceryMerchant, setGroceryMerchant] = useState(result.merchant ?? "");
  const [ingredients, setIngredients] = useState(
    result.kind === "grocery" ? result.ingredients.join("\n") : "",
  );
  const [groceryCorrected, setGroceryCorrected] = useState(false);
  const sym = CURRENCIES[currencyOf(currency)].symbol;

  function edit(key: string, field: keyof Draft, value: string) {
    // Side effects stay outside the updater (StrictMode double-invokes updaters).
    const target = drafts.find((d) => d.key === key);
    if (target && !target.corrected) void logEvent("record_corrected", { field, input_type: inputType });
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, [field]: value, corrected: true } : d)));
  }
  function remove(key: string) {
    void logEvent("record_corrected", { field: "remove_item", input_type: inputType });
    setDrafts((ds) => ds.filter((d) => d.key !== key));
  }

  function save() {
    const ts = Date.now();
    if (result.kind === "grocery") {
      const meal: Meal = {
        id: newId(),
        ts,
        kind: "grocery",
        input_type: "grocery",
        meal_name: `${groceryMerchant || "买菜"} 买菜`,
        merchant: groceryMerchant || null,
        amount_usd: num(groceryAmount),
        kcal_low: null,
        kcal_high: null,
        protein_low_g: null,
        protein_high_g: null,
        confidence: null,
        basis: "买菜小票,只记花销",
        source: null,
        user_corrected: groceryCorrected,
        ingredients: ingredients.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      onSave([meal], { corrected: groceryCorrected });
      return;
    }
    const meals: Meal[] = drafts.map((d) => {
      const amountRaw = num(d.amount);
      // DECISION: an empty amount on a dining-hall photo falls back to the meal-swipe default.
      const amount_usd = amountRaw ?? (inputType === "photo" ? (defaultAmount ?? null) : null);
      return {
        id: newId(),
        ts,
        kind: "meal",
        input_type: inputType,
        meal_name: d.meal_name.trim() || "未命名餐食",
        merchant: d.merchant,
        amount_usd,
        kcal_low: num(d.kcal_low) ?? 0,
        kcal_high: num(d.kcal_high) ?? 0,
        protein_low_g: num(d.protein_low_g) ?? 0,
        protein_high_g: num(d.protein_high_g) ?? 0,
        confidence: d.confidence,
        basis: d.basis,
        source: d.source,
        user_corrected: d.corrected,
      };
    });
    onSave(meals, { corrected: drafts.some((d) => d.corrected) });
  }

  const canSave =
    result.kind === "grocery" ? num(groceryAmount) != null || ingredients.trim() !== "" : drafts.length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        {result.kind === "grocery"
          ? "买菜只记花销,不记营养。确认或修改后保存。"
          : "点任意字段可修改。区间是刻意的:估不准就宽一点,不假装精确。"}
      </p>

      {result.kind === "grocery" ? (
        <div className="space-y-3 rounded-2xl border-2 border-solid border-zinc-300 bg-white p-4">
          <Row label="商家">
            <input
              value={groceryMerchant}
              onChange={(e) => { setGroceryMerchant(e.target.value); setGroceryCorrected(true); }}
              className={inp}
            />
          </Row>
          <Row label={`总金额 ${sym}`}>
            <input
              inputMode="decimal"
              value={groceryAmount}
              onChange={(e) => { setGroceryAmount(e.target.value); setGroceryCorrected(true); }}
              className={inp}
              data-testid="grocery-amount"
            />
          </Row>
          <Row label="食材清单(每行一项)">
            <textarea
              rows={5}
              value={ingredients}
              onChange={(e) => { setIngredients(e.target.value); setGroceryCorrected(true); }}
              className={inp}
            />
          </Row>
        </div>
      ) : (
        drafts.map((d) => (
          <div key={d.key} className={`space-y-3 rounded-2xl bg-white p-4 ${confidenceBorder(d.confidence)}`} data-testid="confirm-item">
            <div className="flex items-start justify-between gap-2">
              <input
                value={d.meal_name}
                onChange={(e) => edit(d.key, "meal_name", e.target.value)}
                className="w-full rounded-lg px-1 text-lg font-semibold outline-none focus:bg-zinc-50"
                aria-label="餐食名"
              />
              {drafts.length > 1 && (
                <button onClick={() => remove(d.key)} className="shrink-0 text-sm text-zinc-400" aria-label="删除这一项">
                  删除
                </button>
              )}
            </div>
            <ConfidenceBadge confidence={d.confidence} source={d.source} />
            <Row label={`金额 ${sym}`}>
              <input
                inputMode="decimal"
                value={d.amount}
                onChange={(e) => edit(d.key, "amount", e.target.value)}
                placeholder={inputType === "photo" && defaultAmount ? `默认 ${defaultAmount}` : "没有价格就留空"}
                className={inp}
                aria-label="金额"
              />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row label="热量 kcal">
                <RangeInput low={d.kcal_low} high={d.kcal_high} onLow={(v) => edit(d.key, "kcal_low", v)} onHigh={(v) => edit(d.key, "kcal_high", v)} />
              </Row>
              <Row label="蛋白质 g">
                <RangeInput low={d.protein_low_g} high={d.protein_high_g} onLow={(v) => edit(d.key, "protein_low_g", v)} onHigh={(v) => edit(d.key, "protein_high_g", v)} />
              </Row>
            </div>
            <Row label="依据">
              <textarea
                rows={2}
                value={d.basis}
                onChange={(e) => edit(d.key, "basis", e.target.value)}
                className={`${inp} text-sm`}
                aria-label="依据"
              />
            </Row>
          </div>
        ))
      )}

      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-zinc-300 bg-white py-3 font-medium">
          取消
        </button>
        <button
          onClick={save}
          disabled={!canSave}
          className="flex-[2] rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-40"
        >
          确认保存
        </button>
      </div>
    </div>
  );
}

const inp = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-base outline-none focus:border-green-600";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function RangeInput({
  low, high, onLow, onHigh,
}: { low: string; high: string; onLow: (v: string) => void; onHigh: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <input inputMode="numeric" value={low} onChange={(e) => onLow(e.target.value)} className={`${inp} text-center`} aria-label="下限" />
      <span className="text-zinc-400">–</span>
      <input inputMode="numeric" value={high} onChange={(e) => onHigh(e.target.value)} className={`${inp} text-center`} aria-label="上限" />
    </div>
  );
}
