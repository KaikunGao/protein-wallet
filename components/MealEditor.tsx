"use client";

import { useState } from "react";
import { CURRENCIES, currencyOf, type Currency } from "@/lib/money";
import type { Meal } from "@/lib/types";

function num(s: string): number | null {
  const n = Number(s);
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
}

/** Bottom sheet to edit a saved record. Grocery rows only expose name and amount. */
export default function MealEditor({
  meal,
  currency,
  onSave,
  onDelete,
  onClose,
}: {
  meal: Meal;
  currency?: Currency;
  onSave: (m: Meal) => void;
  onDelete: (m: Meal) => void;
  onClose: () => void;
}) {
  const sym = CURRENCIES[currencyOf(currency)].symbol;
  const [name, setName] = useState(meal.meal_name);
  const [amount, setAmount] = useState(meal.amount_usd != null ? String(meal.amount_usd) : "");
  const [kl, setKl] = useState(meal.kcal_low != null ? String(meal.kcal_low) : "");
  const [kh, setKh] = useState(meal.kcal_high != null ? String(meal.kcal_high) : "");
  const [pl, setPl] = useState(meal.protein_low_g != null ? String(meal.protein_low_g) : "");
  const [ph, setPh] = useState(meal.protein_high_g != null ? String(meal.protein_high_g) : "");
  const isMeal = meal.kind === "meal";

  function save() {
    onSave({
      ...meal,
      meal_name: name.trim() || meal.meal_name,
      amount_usd: num(amount),
      kcal_low: isMeal ? (num(kl) ?? 0) : null,
      kcal_high: isMeal ? (num(kh) ?? 0) : null,
      protein_low_g: isMeal ? (num(pl) ?? 0) : null,
      protein_high_g: isMeal ? (num(ph) ?? 0) : null,
      user_corrected: true,
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink-900/40 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal>
      <div
        className="w-full max-w-[400px] rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl rise"
        onClick={(e) => e.stopPropagation()}
        data-testid="meal-editor"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-200" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">修改记录</h2>
          <button onClick={onClose} className="text-sm text-ink-400">关闭</button>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="名称">
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" aria-label="名称" />
          </Field>
          <Field label={`金额 ${sym}`}>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" placeholder="留空 = 没花钱" aria-label="金额" />
          </Field>
          {isMeal && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="热量 kcal">
                <div className="flex items-center gap-1">
                  <input inputMode="numeric" value={kl} onChange={(e) => setKl(e.target.value)} className="input-base text-center" aria-label="热量下限" />
                  <span className="text-ink-400">–</span>
                  <input inputMode="numeric" value={kh} onChange={(e) => setKh(e.target.value)} className="input-base text-center" aria-label="热量上限" />
                </div>
              </Field>
              <Field label="蛋白质 g">
                <div className="flex items-center gap-1">
                  <input inputMode="numeric" value={pl} onChange={(e) => setPl(e.target.value)} className="input-base text-center" aria-label="蛋白下限" />
                  <span className="text-ink-400">–</span>
                  <input inputMode="numeric" value={ph} onChange={(e) => setPh(e.target.value)} className="input-base text-center" aria-label="蛋白上限" />
                </div>
              </Field>
            </div>
          )}
          {isMeal && meal.basis && <p className="text-xs text-ink-400">依据:{meal.basis}</p>}
        </div>
        <div className="mt-5 flex gap-3">
          <button onClick={() => onDelete(meal)} className="btn-secondary px-4 py-3 text-red-600">删除</button>
          <button onClick={save} className="btn-primary flex-1 py-3">保存修改</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs mb-1 block">{label}</span>
      {children}
    </label>
  );
}
