"use client";

import type { Feedback } from "@/lib/feedback";
import { cpgUnit, fmtMoney, type Currency } from "@/lib/money";

/**
 * 即时回报: shown right after a save instead of bouncing straight back home.
 * Two computed sentences (this meal's 分/g rank this week; today's gap expressed as the
 * cheapest item in the user's own history). Nothing here is generated or recommended.
 */
export default function FeedbackCard({
  feedback: f,
  overspend,
  currency,
  onDone,
  onMore,
}: {
  feedback: Feedback;
  overspend?: string | null; // 花超提醒: set when this save took today past its budget
  currency?: Currency;
  onDone: () => void;
  onMore: () => void;
}) {
  const met = f.deficit <= 0;
  return (
    <div className="space-y-4 rise" data-testid="feedback">
      <div className="card-hero p-5">
        <p className="text-xs text-white/75">已记 {f.saved} 条</p>
        {f.rank ? (
          <p className="mt-1 text-xl font-semibold tabular-nums" data-testid="feedback-rank">
            这顿 {Math.round(f.rank.cpg)}{cpgUnit(currency)}
            <span className="text-base font-medium text-white/90">
              {f.rank.total > 1 ? ` · 本周第 ${f.rank.rank} 划算(共 ${f.rank.total} 种)` : " · 本周第一条带价格的记录"}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-base font-medium text-white/90" data-testid="feedback-rank">
            {f.unpriced ? "没填价格,这顿不进 分/g 排名" : f.supplement ? "补剂在周报里单列一行,不和食物排名" : "已记入花销"}
          </p>
        )}
        <div className="mt-4 border-t border-white/15 pt-3">
          <p className="text-2xl font-bold tabular-nums" data-testid="feedback-gap">
            {met ? `今天已到目标 +${Math.round(-f.deficit)} g` : `还差 ${Math.round(f.deficit)} g`}
          </p>
          <p className="mt-0.5 text-xs text-white/75">
            已吃约 {Math.round(f.eatenMid)} / {f.target} g
          </p>
        </div>
      </div>

      {overspend && (
        <div className="card border border-dining-100 bg-dining-100 p-4" role="status" data-testid="feedback-overspend">
          <p className="text-sm font-medium text-dining-700">{overspend}。</p>
          <p className="mt-1 text-xs text-dining-700/80">已经记上了,不拦你;只是把数告诉你。</p>
        </div>
      )}

      {!met && (
        <div className="card p-4" data-testid="feedback-suggestion">
          {f.suggestion ? (
            <>
              <p className="text-sm font-medium text-ink-900">
                约等于 {f.suggestion.portions} 份「{f.suggestion.name}」,约 {fmtMoney(f.suggestion.cost, currency)}
              </p>
              <p className="mt-1 text-xs text-ink-400">
                按你最近记录里 分/g 最低的一样算({Math.round(f.suggestion.cpg)}{cpgUnit(currency)}
                {f.suggestion.merchant ? `,${f.suggestion.merchant}` : ""});
                {f.suggestion.portions * f.suggestion.proteinMid < f.deficit ? "最多按 3 份算,不够的部分自己掂量。" : "不是建议,只是把差额换成你吃过的东西。"}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-600">再记几顿带价格的,这里会把差额换算成你吃过的最便宜的东西。</p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onMore} className="btn-secondary flex-1 py-3">
          再记一条
        </button>
        <button onClick={onDone} className="btn-primary flex-[2] py-3">
          回首页
        </button>
      </div>
    </div>
  );
}
