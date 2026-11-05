"use client";

import { useState } from "react";
import ConfidenceBadge from "./ConfidenceBadge";
import { MENU_TOP, rankMenu, type MenuItem, type MenuSort, type RankedDish } from "@/lib/menu-rank";
import { cpgUnit, fmtMoney, type Currency } from "@/lib/money";

/**
 * 拍菜单做决策 (PRD F0-2): the parsed menu, ordered by one visible key. The order comes
 * from rankMenu(), not from the model. Copy states facts ("每块钱蛋白最多的三样") and never
 * says what the user should eat.
 */
export default function MenuRanking({
  venueName,
  items,
  spendable,
  deficit,
  over,
  currency,
  onPick,
  onBack,
  onRename,
  onDelete,
  onShare,
  origin = "own",
  scannedOn,
}: {
  venueName: string; // the menu is kept under this name as a place the user goes to
  items: MenuItem[];
  spendable: number | null;
  deficit: number | null;
  over?: number | null; // how far today is already past its budget
  currency?: Currency;
  onPick: (d: RankedDish, position: number, sort: MenuSort) => void;
  onBack: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onShare?: () => void; // make a link other people can import (not offered for the starter list)
  origin?: "own" | "shared" | "starter";
  scannedOn?: string; // for a shared menu: the day the sharer scanned it
}) {
  const [sort, setSort] = useState<MenuSort>("cpg");
  const [name, setName] = useState(venueName);
  const { ranked, unranked } = rankMenu(items, sort, spendable);
  const top = ranked.slice(0, MENU_TOP);
  const rest = ranked.slice(MENU_TOP);
  const unit = cpgUnit(currency);

  const row = (d: RankedDish, i: number, strong: boolean) => (
    <button
      key={d.id}
      onClick={() => onPick(d, i + 1, sort)}
      className={`flex w-full items-center gap-3 text-left active:opacity-70 ${strong ? "card p-3" : "py-2.5"}`}
      data-testid="menu-row"
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600"}`}>{i + 1}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{d.name}</span>
        <span className="block text-xs text-ink-400">
          {fmtMoney(d.price ?? 0, currency)} · 蛋白 {d.protein_low_g}–{d.protein_high_g} g
          {d.over ? " · 超出今天额度" : ""}
        </span>
        {strong && (
          <span className="mt-1 block">
            <ConfidenceBadge confidence={d.confidence} source={d.source} />
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-semibold tabular-nums">
          {d.cpg.toFixed(1)}
          <span className="text-xs font-normal text-ink-400">{unit}</span>
        </span>
        <span className="block text-[11px] tabular-nums text-ink-400">
          {Math.round(d.cpgLow)}–{Math.round(d.cpgHigh)}
        </span>
      </span>
    </button>
  );

  return (
    <div className="space-y-4 rise" data-testid="menu-ranking">
      {/* 每日清单: the menu is kept as a place, so the home page can rank it every day without a photo. */}
      <div className="card p-3" data-testid="venue-bar">
        <div className="flex items-center gap-2">
          <span className="label-xs shrink-0">已存为</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => onRename(name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="input-base py-1.5 text-sm"
            aria-label="地点名称"
          />
          {onShare && (
            <button onClick={onShare} className="shrink-0 rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700" data-testid="share-venue">
              分享
            </button>
          )}
          <button onClick={onDelete} className="shrink-0 px-1 text-xs text-ink-400">
            删除
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-400" data-testid="venue-note">
          {origin === "starter"
            ? "内置的起步清单:超市能买到的基础食材,价格是参考价,以你那里的为准。用不上可以删掉,删了不会再出现。"
            : origin === "shared"
              ? `这是别人分享的菜单${scannedOn ? `,拍于 ${scannedOn}` : ""}。价格可能已经变了,数字也没经过你核对;自己重拍一次这个地方就会更新。`
              : "存下来了。以后首页每天会把这里的菜和你记过的一起排,不用再拍。点「分享」把它发给同学,对方不用再拍。"}
        </p>
      </div>

      <div>
        <p className="text-sm text-ink-600" data-testid="menu-summary">
          读出 {items.length} 道,{ranked.length} 道有价格和蛋白来源,能排。
          {deficit != null && spendable != null && deficit > 0
            ? ` 今天还差 ${Math.round(deficit)} g,${over != null && over > 0 ? `今天已花超 ${fmtMoney(over, currency)}` : `还能花 ${fmtMoney(spendable, currency)}`}。`
            : ""}
        </p>
        <div className="mt-3 flex rounded-2xl bg-ink-100 p-1" role="tablist">
          {(["cpg", "protein"] as MenuSort[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={sort === s}
              onClick={() => setSort(s)}
              className={`flex-1 rounded-xl py-2 text-sm transition ${sort === s ? "bg-white font-semibold text-ink-900 shadow-sm" : "text-ink-600"}`}
            >
              {s === "cpg" ? "按每块钱蛋白" : "按每份蛋白"}
            </button>
          ))}
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="card p-4 text-sm text-ink-400">这张菜单上没有读到带价格又有蛋白的菜。换个角度重拍,或者把菜名和价格打出来。</p>
      ) : (
        <section className="space-y-2">
          <h2 className="label-xs">{sort === "cpg" ? "每块钱蛋白最多的三样" : "每份蛋白最多的三样"} · 点一样去确认并记上</h2>
          {top.map((d, i) => row(d, i, true))}
        </section>
      )}

      {rest.length > 0 && (
        <section className="card px-4 py-1">
          <ol className="divide-y divide-ink-100">{rest.map((d, i) => <li key={d.id}>{row(d, i + MENU_TOP, false)}</li>)}</ol>
        </section>
      )}

      {unranked.length > 0 && (
        <p className="text-xs text-ink-400" data-testid="menu-unranked">
          没排进来的 {unranked.length} 样(没读到价格、纯主食或纯蔬菜、或几乎没有蛋白):{unranked.map((u) => u.name).join("、")}
        </p>
      )}

      <p className="text-xs text-ink-400">
        顺序是按 {unit} 算出来的,不是推荐。右边小字是 {unit} 的区间:菜单上看不到份量,数字是按菜名估的,区间越宽越没把握。
      </p>

      <button onClick={onBack} className="btn-secondary w-full py-3">
        换一张菜单
      </button>
    </div>
  );
}
