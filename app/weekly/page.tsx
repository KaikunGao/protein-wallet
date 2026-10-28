"use client";

import { useCallback, useEffect, useState } from "react";
import { getSettings, listMealsByWeek, logEvent } from "@/lib/db";
import { addDays, fmtDate } from "@/lib/dates";
import { cpgUnit, fmtMoney } from "@/lib/derive";
import { CURRENCIES, currencyOf } from "@/lib/money";
import { renderWeeklyShareImage } from "@/lib/share-image";
import { buildWeeklyReport, type WeeklyReport } from "@/lib/weekly";
import type { Settings } from "@/lib/types";

export default function WeeklyPage() {
  const [offset, setOffset] = useState(0); // 0 = this week, -1 = last week
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [share, setShare] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
    setShare(null);
    void load(offset).then(() => logEvent("page_open", { page: "weekly", offset }));
  }, [load, offset]);

  if (settings === undefined) return <p className="py-8 text-ink-400">加载中…</p>;
  if (settings === null) return <p className="py-8 text-ink-400">先在今日页完成设置。</p>;
  if (!report) return <p className="py-8 text-ink-400">加载中…</p>;

  const pctSpent = report.budget > 0 ? Math.min(100, (100 * report.spend) / report.budget) : 0;
  const over = report.spend > report.budget;
  const cur = currencyOf(settings.currency);
  const money = (n: number) => fmtMoney(n, cur);

  async function makeImage() {
    if (!report) return;
    setBusy(true);
    try {
      const blob = await renderWeeklyShareImage(report, settings!.protein_target_g, cur);
      setShare({ url: URL.createObjectURL(blob), blob });
      void logEvent("export", { kind: "share_image", offset });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "生成失败");
      setTimeout(() => setMsg(null), 1500);
    } finally {
      setBusy(false);
    }
  }

  async function shareImage() {
    if (!share) return;
    const file = new File([share.blob], `protein-wallet-${fmtDate(report!.weekStart).replace("/", "-")}.png`, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "蛋白钱包周报" });
        return;
      } catch {
        /* user cancelled or share failed: fall back to download */
      }
    }
    const a = document.createElement("a");
    a.href = share.url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="space-y-5 py-2">
      <header className="flex items-end justify-between">
        <div>
          <p className="label-xs">周报</p>
          <h1 className="text-2xl font-bold tracking-tight tabular-nums" data-testid="week-range">
            {fmtDate(report.weekStart)} – {fmtDate(addDays(report.weekEnd, -1))}
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOffset((o) => o - 1)} className="btn-secondary h-9 w-9 text-lg leading-none" aria-label="上一周">‹</button>
          <button onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} className="btn-secondary h-9 w-9 text-lg leading-none disabled:opacity-30" aria-label="下一周">›</button>
        </div>
      </header>

      {/* 1. spend vs budget */}
      <section className="card-hero p-5" data-testid="mod-spend">
        <p className="text-xs text-white/75">本周花销 vs 预算</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">
          {money(report.spend)}
          <span className="ml-2 text-base font-normal text-white/75">/ {money(report.budget)}</span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/25">
          <div className={`h-full rounded-full ${over ? "bg-red-300" : "bg-white"}`} style={{ width: `${pctSpent}%` }} />
        </div>
        <p className="mt-2 text-sm text-white/90">
          {over ? `超出 ${money(report.spend - report.budget)}` : `还剩 ${money(report.budget - report.spend)}`}
          {report.avgCpg != null && ` · 每克蛋白平均 ${report.avgCpg.toFixed(1)}${CURRENCIES[cur].minor}`}
        </p>
      </section>

      {/* 2. protein days */}
      <section className="card p-4" data-testid="mod-protein">
        <p className="label-xs">蛋白质达标天数 · 目标 {settings.protein_target_g} g/天</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">
          {report.daysMet}
          <span className="ml-1 text-base font-normal text-ink-400">天达标 / {report.daysRecorded} 天有记录</span>
        </p>
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {report.days.map((d) => (
            <div
              key={d.key}
              className={`rounded-xl py-2 text-center text-xs ${
                d.proteinMid == null ? "bg-ink-100/60 text-ink-200" : d.met ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-600"
              }`}
            >
              <div>{d.label}</div>
              <div className="mt-0.5 font-semibold tabular-nums">{d.proteinMid == null ? "–" : Math.round(d.proteinMid)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. cents-per-gram ranking */}
      <section className="card p-4" data-testid="mod-rank">
        <p className="label-xs">蛋白质单价排行榜 · {cpgUnit(cur)},越低越划算</p>
        {report.ranking.length === 0 ? (
          <p className="mt-2 text-sm text-ink-400">本周还没有带金额和蛋白质的记录。</p>
        ) : (
          <ol className="mt-2 divide-y divide-ink-100">
            {report.ranking.map((r, i) => (
              <li key={`${r.merchant}|${r.name}`} className="flex items-center gap-3 py-2.5" data-testid="rank-row">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-ink-400">
                    {r.merchant ?? "无商家"} · {r.times} 次 · {money(r.amount)} / 约 {Math.round(r.proteinMid)} g
                  </p>
                </div>
                <span className="text-base font-semibold tabular-nums">{r.cpg.toFixed(1)}<span className="text-xs font-normal text-ink-400">{cpgUnit(cur)}</span></span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 4. vs last week */}
      <section className="card p-4" data-testid="mod-delta">
        <p className="label-xs">与上周相比</p>
        <p className="mt-1 text-sm">{report.delta}</p>
      </section>

      {/* 5. share */}
      <section className="card p-4" data-testid="mod-share">
        <p className="label-xs">分享</p>
        {share ? (
          <div className="mt-2 space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={share.url} alt="周报分享图" className="w-full rounded-2xl border border-ink-100" data-testid="share-preview" />
            <div className="flex gap-3">
              <button onClick={makeImage} className="btn-secondary flex-1 py-2.5 text-sm">重新生成</button>
              <button onClick={shareImage} className="btn-primary flex-[2] py-2.5 text-sm">分享 / 保存图片</button>
            </div>
          </div>
        ) : (
          <button onClick={makeImage} disabled={busy} className="btn-primary mt-2 w-full py-3" data-testid="share-button">
            {busy ? "生成中…" : "生成周报分享图"}
          </button>
        )}
      </section>

      {msg && (
        <p className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-ink-900 px-4 py-2 text-sm text-white shadow-lg" role="status">{msg}</p>
      )}
    </div>
  );
}
