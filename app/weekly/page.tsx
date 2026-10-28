"use client";

import { useCallback, useEffect, useState } from "react";
import { getSettings, listMealsByWeek, logEvent } from "@/lib/db";
import { addDays, fmtDate } from "@/lib/dates";
import { cpgUnit, fmtMoney } from "@/lib/derive";
import { CURRENCIES, currencyOf } from "@/lib/money";
import { buildWeeklyReport, type WeeklyReport } from "@/lib/weekly";
import type { Settings } from "@/lib/types";

export default function WeeklyPage() {
  const [offset, setOffset] = useState(0); // 0 = this week, -1 = last week
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [report, setReport] = useState<WeeklyReport | null>(null);

  const load = useCallback(async (off: number) => {
    const s = await getSettings();
    setSettings(s);
    if (!s) return;
    const ref = addDays(Date.now(), off * 7);
    const [week, prev] = await Promise.all([listMealsByWeek(ref), listMealsByWeek(addDays(ref, -7))]);
    setReport(buildWeeklyReport(week, prev, s, ref));
  }, []);

  useEffect(() => {
    // Async IndexedDB load; state is set after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(offset).then(() => logEvent("page_open", { page: "weekly", offset }));
  }, [load, offset]);

  if (settings === undefined) return <p className="py-8 text-zinc-500">加载中…</p>;
  if (settings === null) return <p className="py-8 text-zinc-500">先在今日页完成设置。</p>;
  if (!report) return <p className="py-8 text-zinc-500">加载中…</p>;

  const pctSpent = report.budget > 0 ? Math.min(100, (100 * report.spend) / report.budget) : 0;
  const over = report.spend > report.budget;
  const cur = currencyOf(settings.currency);
  const money = (n: number) => fmtMoney(n, cur);

  return (
    <div className="space-y-5 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">周报</h1>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setOffset((o) => o - 1)} className="rounded-lg border border-zinc-300 bg-white px-3 py-1" aria-label="上一周">
            ‹
          </button>
          <span className="tabular-nums text-zinc-600" data-testid="week-range">
            {fmtDate(report.weekStart)} – {fmtDate(addDays(report.weekEnd, -1))}
          </span>
          <button
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            disabled={offset === 0}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1 disabled:opacity-30"
            aria-label="下一周"
          >
            ›
          </button>
        </div>
      </div>

      {/* 1. spend vs budget */}
      <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mod-spend">
        <p className="text-xs text-zinc-500">本周花销 vs 预算</p>
        <p className={`mt-1 text-3xl font-bold tabular-nums ${over ? "text-red-600" : ""}`}>
          {money(report.spend)}
          <span className="ml-2 text-base font-normal text-zinc-500">/ {money(report.budget)}</span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
          <div className={`h-full ${over ? "bg-red-500" : "bg-green-600"}`} style={{ width: `${pctSpent}%` }} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {over ? `超出 ${money(report.spend - report.budget)}` : `还剩 ${money(report.budget - report.spend)}`}
          {report.avgCpg != null && ` · 本周每克蛋白平均 ${report.avgCpg.toFixed(1)}${CURRENCIES[cur].minor}`}
        </p>
      </section>

      {/* 2. protein days */}
      <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mod-protein">
        <p className="text-xs text-zinc-500">蛋白质达标天数(目标 {settings.protein_target_g} g/天)</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">
          {report.daysMet}
          <span className="ml-1 text-base font-normal text-zinc-500">天达标 / {report.daysRecorded} 天有记录</span>
        </p>
        <div className="mt-3 grid grid-cols-7 gap-1">
          {report.days.map((d) => (
            <div
              key={d.key}
              className={`rounded-lg py-2 text-center text-xs ${
                d.proteinMid == null ? "bg-zinc-50 text-zinc-300" : d.met ? "bg-green-100 text-green-800" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              <div>{d.label}</div>
              <div className="mt-0.5 font-semibold tabular-nums">{d.proteinMid == null ? "–" : Math.round(d.proteinMid)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. cents-per-gram ranking */}
      <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mod-rank">
        <p className="text-xs text-zinc-500">蛋白质单价排行榜({cpgUnit(cur)},越低越划算)</p>
        {report.ranking.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">本周还没有带金额和蛋白质的记录。</p>
        ) : (
          <ol className="mt-2 divide-y divide-zinc-100">
            {report.ranking.map((r, i) => (
              <li key={`${r.merchant}|${r.name}`} className="flex items-center gap-3 py-2" data-testid="rank-row">
                <span className="w-5 text-sm tabular-nums text-zinc-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-zinc-500">
                    {r.merchant ?? "无商家"} · {r.times} 次 · {money(r.amount)} / 约 {Math.round(r.proteinMid)} g
                  </p>
                </div>
                <span className="text-base font-semibold tabular-nums">{r.cpg.toFixed(1)}{cpgUnit(cur)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 4. vs last week */}
      <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mod-delta">
        <p className="text-xs text-zinc-500">与上周相比</p>
        <p className="mt-1 text-sm">{report.delta}</p>
      </section>
    </div>
  );
}
