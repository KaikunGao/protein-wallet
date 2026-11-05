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
import { CURRENCIES, DEFAULT_CURRENCY } from "@/lib/money";

export default function SettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [existing, setExisting] = useState<Settings | null>(null);
  const [weight, setWeight] = useState("");
  const [target, setTarget] = useState("");
  const [budget, setBudget] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [counts, setCounts] = useState({ meals: 0, events: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const sym = CURRENCIES[DEFAULT_CURRENCY].symbol;

  async function refreshCounts() {
    const [meals, events] = await Promise.all([listAllMeals(), listAllEvents()]);
    setCounts({ meals: meals.length, events: events.length });
  }

  function fill(s: Settings) {
    setWeight(s.weight_kg ? String(s.weight_kg) : "");
    setTarget(String(s.protein_target_g));
    setBudget(String(s.weekly_budget_usd));
  }

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setExisting(s);
      if (s) fill(s);
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
      currency: DEFAULT_CURRENCY,
      created_at: existing?.created_at,
    });
    await saveSettings(s);
    setExisting(s);
    fill(s);
    setMsg("已保存");
    setTimeout(() => setMsg(null), 1500);
  }

  async function onExport() {
    const bundle = await exportAll();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
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
      if (s) fill(s);
      await refreshCounts();
      void logEvent("import", r);
      setMsg(`已导入 ${r.meals} 条记录`);
    } catch (e) {
      setMsg(`导入失败:${e instanceof Error ? e.message : "文件格式错误"}`);
    }
  }

  if (!loaded) return <p className="py-8 text-ink-400">加载中…</p>;

  return (
    <div className="space-y-5 py-2">
      <header>
        <p className="label-xs">设置</p>
        <h1 className="text-2xl font-bold tracking-tight">你的目标和预算</h1>
      </header>

      <Section title="身体与目标">
        <Field label="体重 (kg,可选)">
          <input inputMode="decimal" value={weight} onChange={(e) => onWeightChange(e.target.value)} placeholder="例如 70" className="input-base" />
        </Field>
        <Field label="每日蛋白质目标 (g)" hint="默认按体重 ×1.6;没填体重则 100g">
          <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" className="input-base" />
        </Field>
      </Section>

      <Section title="钱">
        <Field label={`每周饮食预算 (${sym})`}>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="例如 500" className="input-base" />
        </Field>
      </Section>

      <button onClick={onSave} disabled={!budget} className="btn-primary w-full py-3">
        保存
      </button>

      <Section title="数据">
        <p className="text-sm text-ink-600" data-testid="counts">
          本机共 {counts.meals} 条记录、{counts.events} 条事件。数据只存在这台设备的浏览器里,建议定期导出。
        </p>
        <div className="flex gap-3">
          <button onClick={onExport} className="btn-secondary flex-1 py-2.5 text-sm">导出 JSON</button>
          <button onClick={() => fileRef.current?.click()} className="btn-secondary flex-1 py-2.5 text-sm">导入 JSON</button>
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
      </Section>

      {msg && (
        <p className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink-900 px-4 py-2 text-sm text-white shadow-lg rise" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}
