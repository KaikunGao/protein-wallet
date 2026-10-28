"use client";

import { useEffect, useRef, useState } from "react";
import {
  exportAll,
  getSettings,
  importAll,
  listAllEvents,
  listAllMeals,
  logEvent,
  saveSettings,
} from "@/lib/db";
import { buildSettings, proteinTargetFromWeight } from "@/lib/settings";
import type { ExportBundle, Settings } from "@/lib/types";
import halls from "@/data/dining/uchicago/halls.json";
import { CURRENCIES, currencyOf, type Currency } from "@/lib/money";

export default function SettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [existing, setExisting] = useState<Settings | null>(null);
  const [weight, setWeight] = useState("");
  const [target, setTarget] = useState("");
  const [budget, setBudget] = useState("");
  const [swipe, setSwipe] = useState("");
  const [hall, setHall] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [msg, setMsg] = useState<string | null>(null);
  const [counts, setCounts] = useState({ meals: 0, events: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  async function refreshCounts() {
    const [meals, events] = await Promise.all([listAllMeals(), listAllEvents()]);
    setCounts({ meals: meals.length, events: events.length });
  }

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setExisting(s);
      if (s) {
        setWeight(s.weight_kg ? String(s.weight_kg) : "");
        setTarget(String(s.protein_target_g));
        setBudget(String(s.weekly_budget_usd));
        setSwipe(s.meal_swipe_usd ? String(s.meal_swipe_usd) : "");
        setHall(s.dining_hall ?? "");
        setCurrency(currencyOf(s.currency));
      }
      await refreshCounts();
      setLoaded(true);
      void logEvent("page_open", { page: "settings" });
    })();
  }, []);

  function onWeightChange(v: string) {
    setWeight(v);
    const w = Number(v);
    // Keep target in sync with weight unless the user typed a custom target.
    if (!target || Number(target) === proteinTargetFromWeight(existing?.weight_kg)) {
      setTarget(String(proteinTargetFromWeight(w)));
    }
  }

  async function onSave() {
    const s = buildSettings({
      weight_kg: weight ? Number(weight) : null,
      protein_target_g: target ? Number(target) : null,
      weekly_budget_usd: Number(budget),
      meal_swipe_usd: swipe ? Number(swipe) : null,
      dining_hall: hall || null,
      currency,
      created_at: existing?.created_at,
    });
    await saveSettings(s);
    setExisting(s);
    setTarget(String(s.protein_target_g));
    setMsg("已保存");
    setTimeout(() => setMsg(null), 1500);
  }

  async function onExport() {
    const bundle = await exportAll();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `protein-wallet-${bundle.exported_at.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    void logEvent("export", { meals: bundle.meals.length });
    setMsg(`已导出 ${bundle.meals.length} 条记录`);
  }

  async function onImportFile(file: File) {
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as ExportBundle;
      const r = await importAll(bundle);
      const s = await getSettings();
      setExisting(s);
      if (s) {
        setWeight(s.weight_kg ? String(s.weight_kg) : "");
        setTarget(String(s.protein_target_g));
        setBudget(String(s.weekly_budget_usd));
        setSwipe(s.meal_swipe_usd ? String(s.meal_swipe_usd) : "");
        setHall(s.dining_hall ?? "");
        setCurrency(currencyOf(s.currency));
      }
      await refreshCounts();
      void logEvent("import", r);
      setMsg(`已导入 ${r.meals} 条记录`);
    } catch (e) {
      setMsg(`导入失败:${e instanceof Error ? e.message : "文件格式错误"}`);
    }
  }

  if (!loaded) return <p className="py-8 text-zinc-500">加载中…</p>;

  return (
    <div className="space-y-6 py-2">
      <h1 className="text-2xl font-bold">设置</h1>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <Field label="体重 (kg,可选)">
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => onWeightChange(e.target.value)}
            placeholder="例如 70"
            className={inputCls}
          />
        </Field>
        <Field label="每日蛋白质目标 (g)" hint="默认按体重 ×1.6;没填体重则 100g">
          <input
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="100"
            className={inputCls}
          />
        </Field>
        <Field label="记账货币" hint="只决定符号和单位(¢/g 或 分/g),不做汇率换算;已有记录按原样显示">
          <div className="grid grid-cols-2 gap-2" data-testid="currency-toggle">
            {(Object.keys(CURRENCIES) as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                aria-pressed={currency === c}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  currency === c ? "border-green-600 bg-green-50 font-semibold text-green-800" : "border-zinc-300 bg-white text-zinc-600"
                }`}
              >
                {CURRENCIES[c].symbol} {CURRENCIES[c].name}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`每周饮食预算 (${CURRENCIES[currency].symbol})`}>
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder={currency === "CNY" ? "例如 500" : "例如 120"}
            className={inputCls}
          />
        </Field>
        <Field label={`食堂一次刷卡默认单价 (${CURRENCIES[currency].symbol},可选)`}>
          <input
            inputMode="decimal"
            value={swipe}
            onChange={(e) => setSwipe(e.target.value)}
            placeholder={currency === "CNY" ? "例如 15" : "例如 12"}
            className={inputCls}
          />
        </Field>
        <Field label="常去的食堂(可选)" hint="记一餐时默认选中;选了食堂,拍餐盘会按食堂官方菜品库算">
          <select value={hall} onChange={(e) => setHall(e.target.value)} className={inputCls} data-testid="hall-select">
            <option value="">不设</option>
            {halls.halls.map((h) => (
              <option key={h.slug} value={h.slug}>
                {h.short} · {h.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          onClick={onSave}
          disabled={!budget}
          className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white disabled:opacity-40"
        >
          保存
        </button>
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">数据</h2>
        <p className="text-sm text-zinc-500" data-testid="counts">
          本机共 {counts.meals} 条记录、{counts.events} 条事件。数据只存在这台设备的浏览器里,建议定期导出。
        </p>
        <div className="flex gap-3">
          <button onClick={onExport} className={btnSecondary}>
            导出 JSON
          </button>
          <button onClick={() => fileRef.current?.click()} className={btnSecondary}>
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {msg && (
        <p className="rounded-xl bg-zinc-900 px-4 py-2 text-center text-sm text-white" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-zinc-300 px-3 py-2 text-base outline-none focus:border-green-600";
const btnSecondary =
  "flex-1 rounded-xl border border-zinc-300 bg-white py-2.5 text-sm font-medium";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}
