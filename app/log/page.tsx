"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmCard from "@/components/ConfirmCard";
import FeedbackCard from "@/components/FeedbackCard";
import MenuRanking from "@/components/MenuRanking";
import VoiceButton from "@/components/VoiceButton";
import { fmtDate, fmtTime } from "@/lib/dates";
import { addMeal, deleteMenu, getSettings, listMealsByDay, listMealsByWeek, listMealsSince, listMenus, logEvent, newId, saveMenu } from "@/lib/db";
import type { EstimateResponse } from "@/lib/estimate/schema";
import { proteinDeficit } from "@/lib/derive";
import { buildFeedback, type Feedback } from "@/lib/feedback";
import { compressImage } from "@/lib/image";
import { toEstimateItem, upsertMenu, type MenuResponse, type MenuSort, type RankedDish, type SavedMenu } from "@/lib/menu-rank";
import { decodeMenus, encodeMenus, payloadFromHash, shareUrl, type IncomingMenu } from "@/lib/menu-share";
import { currencyOf } from "@/lib/money";
import { spendableToday } from "@/lib/next-meal";
import type { InputType, Meal, Settings } from "@/lib/types";

type Phase =
  | { kind: "input" }
  | { kind: "loading"; inputType: InputType; preview?: string }
  | { kind: "confirm"; inputType: InputType; result: Extract<EstimateResponse, { ok: true }> }
  | { kind: "error"; inputType: InputType; message: string; retryable: boolean }
  | { kind: "saved"; feedback: Feedback }
  | { kind: "ranked"; ranking: Ranking }
  | { kind: "incoming"; menus: IncomingMenu[] }; // places from a share link, waiting for the user's OK

// A menu (kept as a place) plus today's context, held so "取消" on the confirm card returns to the list.
interface Ranking {
  venue: SavedMenu;
  spendable: number | null;
  deficit: number | null;
}

// 记一餐 = one meal now (photo / receipt / sentence). 日结 = one sentence for the whole day,
// split into one record per 顿 (PRD 2026-11-04 记录成本方案 #1). 拍菜单 = before eating:
// a menu is parsed and ranked by 分/g, and picking a dish records it (PRD F0-2).
type Mode = "meal" | "day" | "menu";
const MODE_LABEL: Record<Mode, string> = { meal: "记一餐", day: "日结", menu: "拍菜单" };
const MODE_TITLE: Record<Mode, string> = { meal: "记一餐", day: "日结", menu: "拍菜单" };
// Menu boards are text-heavy: keep more pixels than for a plate photo.
const MENU_IMAGE_PX = 1568;
// Wall-clock reads live outside the component: the purity lint treats any Date.now()
// reachable from a handler that is wired up during render as a render-time call.
const nowMs = () => Date.now();
const HISTORY_DAYS = 30;

type PhotoType = Exclude<InputType, "text">;

const PHOTO_BUTTONS: { type: PhotoType; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    type: "receipt",
    label: "拍小票",
    hint: "记账 + 记餐一步到位",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
  },
  {
    type: "photo",
    label: "拍餐盘",
    hint: "食堂、外卖、自己做",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 7.5v1.5" />
      </svg>
    ),
  },
  {
    type: "grocery",
    label: "买菜小票",
    hint: "只记花销",
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.5" />
        <circle cx="9.5" cy="20" r="1.3" />
        <circle cx="16.5" cy="20" r="1.3" />
      </svg>
    ),
  },
];

export default function LogPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>("meal");
  const [menus, setMenus] = useState<SavedMenu[]>([]); // saved places (每日清单)
  const [toast, setToast] = useState<string | null>(null);
  const startTs = useRef(0); // set in useEffect: nowMs() must not run during prerender
  const voiceBase = useRef(""); // text already in the box when a voice session starts
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rankingRef = useRef<Ranking | null>(null); // last parsed menu, to come back to from the confirm card

  useEffect(() => {
    startTs.current = nowMs();
    // /log?mode=day comes from the home page's 日结 link; read it here so the page stays static.
    const q = new URLSearchParams(window.location.search).get("mode");
    const initial: Mode = q === "day" || q === "menu" ? q : "meal";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial !== "meal") setMode(initial);
    void logEvent("record_start", { mode: initial });
    getSettings().then(setSettings);
    listMenus().then(setMenus);
    // 菜单分享链接: /log?mode=menu#m=… carries someone else's saved places. Nothing is stored
    // until the user says so; the hash is dropped so a reload does not ask again.
    const readShare = () => {
      const shared = payloadFromHash(window.location.hash);
      if (!shared) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      void decodeMenus(shared).then((incoming) => {
        setMode("menu");
        if (incoming) setPhase({ kind: "incoming", menus: incoming });
        else setPhase({ kind: "error", inputType: "text", message: "这个分享链接打不开:内容不完整,或者版本不对。让对方重新发一次。", retryable: false });
      });
    };
    readShare();
    // A link pasted into a tab that already shows this page only changes the hash: no reload, so listen for it.
    window.addEventListener("hashchange", readShare);
    return () => window.removeEventListener("hashchange", readShare);
  }, []);

  const currency = currencyOf(settings?.currency);

  async function runEstimate(body: { type: InputType; content: string }, preview?: string) {
    setPhase({ kind: "loading", inputType: body.type, preview });
    // dining_hall is not sent: the 国内 食堂菜品库 does not exist yet (PRD 国内版 step 4).
    const payload = { ...body, currency, ...(body.type === "text" && mode === "day" ? { batch: true } : {}) };
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as EstimateResponse;
      if (!data.ok) {
        void logEvent("record_failed", { input_type: body.type, error: data.error });
        setPhase({ kind: "error", inputType: body.type, message: data.error, retryable: data.retryable });
        return;
      }
      void logEvent("record_parsed", {
        input_type: body.type,
        items: data.kind === "meal" ? data.items.length : 0,
        sources: data.kind === "meal" ? data.items.map((i) => i.source) : ["grocery"],
        ms: nowMs() - startTs.current,
      });
      setPhase({ kind: "confirm", inputType: body.type, result: data });
    } catch {
      void logEvent("record_failed", { input_type: body.type, error: "network" });
      setPhase({ kind: "error", inputType: body.type, message: "网络出错,请重试", retryable: true });
    }
  }

  /** 拍菜单: parse a menu (photo or typed), then rank it on the client by 分/g. */
  async function runMenu(body: { type: "photo" | "text"; content: string }, preview?: string) {
    setPhase({ kind: "loading", inputType: "menu", preview });
    try {
      const res = await fetch("/api/menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as MenuResponse;
      if (!data.ok) {
        void logEvent("record_failed", { input_type: "menu", error: data.error });
        setPhase({ kind: "error", inputType: body.type === "text" ? "text" : "menu", message: data.error, retryable: data.retryable });
        return;
      }
      // Keep the menu as a place right away: menus rarely change, so this scan is the only
      // one this place needs. Scanning it again replaces its dishes.
      const now = nowMs();
      const venue = upsertMenu(await listMenus(), data.merchant ?? `菜单 ${fmtDate(now)} ${fmtTime(now)}`, data.items, newId(), now);
      await saveMenu(venue);
      setMenus(await listMenus());
      const ranking: Ranking = { venue, ...(await todayContext()) };
      rankingRef.current = ranking;
      void logEvent("menu_ranked", {
        input: body.type,
        n: data.items.length,
        priced: data.items.filter((i) => i.price != null).length,
        from_table: data.items.filter((i) => i.source === "ingredient_table").length,
        ms: nowMs() - startTs.current,
      });
      setPhase({ kind: "ranked", ranking });
    } catch {
      void logEvent("record_failed", { input_type: "menu", error: "network" });
      setPhase({ kind: "error", inputType: body.type === "text" ? "text" : "menu", message: "网络出错,请重试", retryable: true });
    }
  }

  /** Today's numbers for the "超出今天额度" flag and the summary line. */
  async function todayContext(): Promise<{ spendable: number | null; deficit: number | null }> {
    const s = settings ?? (await getSettings());
    const [today, week] = await Promise.all([listMealsByDay(), listMealsByWeek()]);
    return {
      spendable: s ? spendableToday(week, s, nowMs()) : null,
      deficit: s ? proteinDeficit(today, s) : null,
    };
  }

  /** Open a saved place: no photo, no model call. */
  async function openSaved(venue: SavedMenu) {
    const ranking: Ranking = { venue, ...(await todayContext()) };
    rankingRef.current = ranking;
    void logEvent("menu_ranked", {
      input: "saved",
      n: venue.items.length,
      priced: venue.items.filter((i) => i.price != null).length,
      from_table: venue.items.filter((i) => i.source === "ingredient_table").length,
      ms: 0,
    });
    setPhase({ kind: "ranked", ranking });
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  /** Make a link that carries these places; the receiver imports them without scanning. */
  async function sharePlaces(places: SavedMenu[]) {
    const own = places.filter((m) => !m.starter); // everyone already has the starter list
    if (own.length === 0) return;
    const url = shareUrl(window.location.origin, await encodeMenus(own));
    const title = own.length === 1 ? `「${own[0].name}」的菜单` : `${own.length} 个地方的菜单`;
    void logEvent("menu_shared", { places: own.length, dishes: own.reduce((a, m) => a + m.items.length, 0), chars: url.length });
    try {
      if (navigator.share) {
        await navigator.share({ title: `蛋白钱包 · ${title}`, text: `${title},按每块钱蛋白排好了,点开就能用,不用再拍。`, url });
        return;
      }
    } catch {
      /* cancelled or not allowed: fall through to copying */
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("链接已复制,发给同学就行");
    } catch {
      window.prompt("复制这个链接发给同学", url);
    }
  }

  /** The user accepted the places from a share link: store them. Same-named places are updated. */
  async function acceptIncoming(incoming: IncomingMenu[]) {
    let existing = await listMenus();
    let last: SavedMenu | null = null;
    for (const inc of incoming) {
      const venue: SavedMenu = { ...upsertMenu(existing, inc.name, inc.items, newId(), nowMs()), shared_ts: inc.scanned_ts || nowMs() };
      await saveMenu(venue);
      existing = [venue, ...existing.filter((m) => m.id !== venue.id)];
      last = venue;
    }
    void logEvent("menu_imported", { places: incoming.length, dishes: incoming.reduce((a, m) => a + m.items.length, 0) });
    setMenus(await listMenus());
    if (incoming.length === 1 && last) await openSaved(last);
    else {
      setPhase({ kind: "input" });
      flash(`存好了 ${incoming.length} 个地方,首页清单已经用上`);
    }
  }

  async function renameVenue(name: string) {
    const cur = rankingRef.current;
    const clean = name.trim();
    if (!cur || !clean || clean === cur.venue.name) return;
    const venue = { ...cur.venue, name: clean };
    await saveMenu(venue);
    rankingRef.current = { ...cur, venue };
    setMenus(await listMenus());
  }

  async function deleteVenue() {
    const cur = rankingRef.current;
    if (!cur || !window.confirm(`删除「${cur.venue.name}」?首页的清单里不再出现这里的菜。`)) return;
    await deleteMenu(cur.venue.id);
    rankingRef.current = null;
    setMenus(await listMenus());
    setPhase({ kind: "input" });
  }

  /** A row of the ranking was tapped: hand the dish to the normal confirm card. */
  function pickDish(d: RankedDish, position: number, sort: MenuSort) {
    void logEvent("rank_picked", { where: "menu", position, sort, cpg: Math.round(d.cpg * 10) / 10, over: d.over, source: d.source });
    const merchant = rankingRef.current?.venue.name ?? null; // the place name, so the record lines up with the saved menu
    setPhase({
      kind: "confirm",
      inputType: "menu",
      result: { ok: true, kind: "meal", merchant, total_usd: d.price, items: [toEstimateItem(d, merchant)] },
    });
  }

  function backToRanking() {
    if (rankingRef.current) setPhase({ kind: "ranked", ranking: rankingRef.current });
    else setPhase({ kind: "input" });
  }

  function submitText() {
    const content = text.trim();
    if (!content) return;
    if (mode === "menu") void runMenu({ type: "text", content });
    else void runEstimate({ type: "text", content });
  }

  async function onFile(type: PhotoType, file: File) {
    let dataUrl: string;
    try {
      dataUrl = type === "menu" ? await compressImage(file, MENU_IMAGE_PX, 0.85) : await compressImage(file);
    } catch (e) {
      setPhase({
        kind: "error",
        inputType: type,
        message: e instanceof Error ? e.message : "图片无法读取",
        retryable: true,
      });
      return;
    }
    if (type === "menu") void runMenu({ type: "photo", content: dataUrl }, dataUrl);
    else if (type === "photo" || type === "receipt" || type === "grocery") void runEstimate({ type, content: dataUrl }, dataUrl);
  }

  async function onSave(saved: Meal[], meta: { corrected: boolean }) {
    // A dish picked from a menu carries the menu's id, so the daily list still knows it
    // after the place is renamed.
    const menuId = mode === "menu" ? rankingRef.current?.venue.id : undefined;
    const meals = menuId ? saved.map((m) => ({ ...m, menu_id: menuId })) : saved;
    for (const m of meals) await addMeal(m);
    void logEvent("record_saved", {
      input_type: meals[0]?.input_type,
      mode,
      n: meals.length,
      corrected: meta.corrected,
      duration_ms: nowMs() - startTs.current,
    });
    const s = settings ?? (await getSettings());
    if (!s || meals.every((m) => m.kind === "grocery")) {
      router.push("/");
      return;
    }
    // 即时回报: rank this meal within the week and turn today's gap into the cheapest
    // item from the user's own history (PRD 记录成本方案 #3).
    const [today, week, history] = await Promise.all([
      listMealsByDay(),
      listMealsByWeek(),
      listMealsSince(nowMs() - HISTORY_DAYS * 86400e3),
    ]);
    const feedback = buildFeedback(meals, week, today, history, s);
    void logEvent("feedback_shown", {
      where: "log",
      rank: feedback.rank?.rank ?? null,
      total: feedback.rank?.total ?? null,
      deficit: Math.round(feedback.deficit),
      suggestion: feedback.suggestion?.name ?? null,
    });
    setPhase({ kind: "saved", feedback });
  }

  function another() {
    startTs.current = nowMs();
    setText("");
    void logEvent("record_start", { mode, after_feedback: true });
    setPhase({ kind: "input" });
  }

  function cancel() {
    void logEvent("record_cancelled");
    router.push("/");
  }

  function onVoiceStart() {
    voiceBase.current = text.trim();
    void logEvent("record_start", { voice: true });
  }
  function onVoiceText(t: string, final: boolean) {
    const base = voiceBase.current;
    setText(base ? `${base} ${t}` : t);
    if (final) textareaRef.current?.focus();
  }

  const example =
    mode === "day"
      ? "早饭鸡蛋牛奶 5 元、午饭食堂鸡腿饭 12 元、晚饭外卖黄焖鸡 22 元、一勺蛋白粉"
      : mode === "menu"
        ? "鸡腿饭 12、番茄炒蛋盖饭 8、牛肉面 16、煎饼果子加蛋 8"
        : "例如:食堂红烧鸡腿 + 米饭 12 元";

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-end justify-between">
        <div>
          <p className="label-xs">记录</p>
          <h1 className="text-2xl font-bold tracking-tight">{MODE_TITLE[mode]}</h1>
        </div>
        {phase.kind !== "saved" && (
          <button onClick={cancel} className="text-sm text-ink-400">
            取消
          </button>
        )}
      </div>

      {phase.kind === "input" && (
        <div className="space-y-4">
          <div className="flex rounded-2xl bg-ink-100 p-1" role="tablist" data-testid="mode-toggle">
            {(["meal", "day", "menu"] as Mode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setMode(m);
                    void logEvent("record_start", { mode: m, switched: true });
                  }}
                  className={`flex-1 rounded-xl py-2 text-sm transition ${active ? "bg-white font-semibold text-ink-900 shadow-sm" : "text-ink-600"}`}
                >
                  {MODE_LABEL[m]}
                </button>
              );
            })}
          </div>

          {mode === "day" && (
            <p className="text-sm text-ink-600" data-testid="day-hint">
              睡前一句话,把今天吃的按顿写出来,用顿号分开,带上价格。会拆成一条一条,保存前可以改。
            </p>
          )}

          {mode === "menu" && (
            <>
              <p className="text-sm text-ink-600" data-testid="menu-hint">
                常去的窗口、小摊、外卖店,菜单拍一次就存下来,之后首页每天直接按每一块钱换多少克蛋白排好,不用再拍。只是排序,吃什么你定。
              </p>
              {menus.length > 0 && (
                <section className="space-y-2" data-testid="saved-venues">
                  <h2 className="label-xs">存过的地方 · 点开直接看</h2>
                  <div className="flex flex-wrap gap-2">
                    {menus.map((m) => (
                      <button key={m.id} onClick={() => openSaved(m)} className="card px-3 py-2 text-left text-sm active:scale-[0.98]" data-testid="venue-chip">
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-1.5 text-xs text-ink-400">{m.items.length} 道</span>
                      </button>
                    ))}
                  </div>
                  {menus.some((m) => !m.starter) && (
                    <button onClick={() => sharePlaces(menus)} className="text-xs font-medium text-brand-700" data-testid="share-all">
                      把我存的地方分享给同学 · 对方不用再拍
                    </button>
                  )}
                </section>
              )}
              <section className="grid grid-cols-2 gap-2">
                <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[1.25rem] bg-brand-600 px-2 py-4 text-center text-white shadow-[0_10px_24px_-12px_rgb(21_128_61/0.8)] transition active:scale-[0.97]">
                  <PhotoInput type="menu" onFile={onFile} />
                  <span className="text-sm font-semibold">拍价目牌</span>
                  <span className="text-[11px] leading-tight text-green-100">窗口、招牌、纸质菜单</span>
                </label>
                <label className="card flex cursor-pointer flex-col items-center gap-1.5 px-2 py-4 text-center text-ink-900 transition active:scale-[0.97]">
                  <PhotoInput type="menu" onFile={onFile} capture={false} testId="input-menu-file" />
                  <span className="text-sm font-semibold">选菜单截图</span>
                  <span className="text-[11px] leading-tight text-ink-400">美团 / 饿了么店铺页</span>
                </label>
              </section>
            </>
          )}

          {mode === "meal" && (
          <section className="grid grid-cols-3 gap-2">
            {PHOTO_BUTTONS.map((b) => {
              const primary = b.type === "receipt";
              return (
                <label
                  key={b.type}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[1.25rem] px-2 py-4 text-center transition active:scale-[0.97] ${
                    primary ? "bg-brand-600 text-white shadow-[0_10px_24px_-12px_rgb(21_128_61/0.8)]" : "card text-ink-900"
                  }`}
                >
                  <PhotoInput type={b.type} onFile={onFile} />
                  <span className={primary ? "text-white" : "text-brand-600"}>{b.icon}</span>
                  <span className="text-sm font-semibold">{b.label}</span>
                  <span className={`text-[11px] leading-tight ${primary ? "text-green-100" : "text-ink-400"}`}>{b.hint}</span>
                </label>
              );
            })}
          </section>
          )}

          <section className="card p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-ink-900">{mode === "day" ? "今天吃了什么" : mode === "menu" ? "或者把菜单打出来" : "或者说一句、打一句"}</p>
              <span className="text-[11px] text-ink-400">{mode === "day" ? "一顿一个价格" : mode === "menu" ? "菜名 + 价格" : "带上价格更好"}</span>
            </div>
            <textarea
              ref={textareaRef}
              rows={mode === "day" ? 4 : 3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder={example}
              className="input-base mt-2 resize-none bg-paper focus:bg-white"
            />
            <div className="mt-3 flex items-center gap-3">
              <VoiceButton onStart={onVoiceStart} onText={onVoiceText} />
              <button
                onClick={submitText}
                disabled={!text.trim()}
                className="btn-primary h-12 flex-1"
              >
                {mode === "day" ? "拆成一条条" : mode === "menu" ? "按每块钱蛋白排" : "解析"}
              </button>
            </div>
          </section>
        </div>
      )}

      {phase.kind === "loading" && (
        <div className="card flex flex-col items-center gap-3 py-10 text-ink-400">
          {phase.preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={phase.preview} alt="" className="max-h-48 rounded-xl object-contain" />
          )}
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-ink-100 border-t-brand-600" />
          <p>{phase.inputType === "menu" ? "在读菜单…" : "AI 解析中…"}</p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="card space-y-4 p-4">
          <p className="font-medium text-red-700">{phase.message}</p>
          <div className="flex gap-3">
            {phase.retryable && phase.inputType === "text" && (
              <button onClick={submitText} className="btn-primary flex-1 py-3">
                重试
              </button>
            )}
            {phase.inputType !== "text" && (
              <label className="btn-primary flex-1 cursor-pointer py-3 text-center">
                <PhotoInput type={phase.inputType as PhotoType} onFile={onFile} />
                重拍
              </label>
            )}
            <button
              onClick={() => setPhase({ kind: "input" })}
              className="btn-secondary flex-1 py-3"
            >
              改用文字输入
            </button>
          </div>
        </div>
      )}

      {phase.kind === "confirm" && (
        <ConfirmCard
          result={phase.result}
          inputType={phase.inputType}
          currency={currency}
          onSave={onSave}
          onCancel={phase.inputType === "menu" ? backToRanking : cancel}
        />
      )}

      {phase.kind === "ranked" && (
        <MenuRanking
          key={phase.ranking.venue.id}
          venueName={phase.ranking.venue.name}
          items={phase.ranking.venue.items}
          spendable={phase.ranking.spendable}
          deficit={phase.ranking.deficit}
          currency={currency}
          onPick={pickDish}
          onBack={() => setPhase({ kind: "input" })}
          onRename={renameVenue}
          onDelete={deleteVenue}
          onShare={phase.ranking.venue.starter ? undefined : () => sharePlaces([phase.ranking.venue])}
          origin={phase.ranking.venue.starter ? "starter" : phase.ranking.venue.shared_ts ? "shared" : "own"}
          scannedOn={phase.ranking.venue.shared_ts ? fmtDate(phase.ranking.venue.shared_ts) : undefined}
        />
      )}

      {phase.kind === "incoming" && (
        <div className="space-y-4 rise" data-testid="incoming">
          <div className="card space-y-3 p-4">
            <h2 className="text-lg font-semibold">同学分享给你的菜单</h2>
            <ul className="divide-y divide-ink-100">
              {phase.menus.map((m) => (
                <li key={m.name} className="flex items-baseline justify-between gap-2 py-2">
                  <span className="min-w-0 truncate text-sm font-medium">{m.name}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {m.items.length} 道{m.scanned_ts ? ` · 拍于 ${fmtDate(m.scanned_ts)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-400">
              存下来之后,首页的清单每天会把这些地方的菜和你记过的一起按每块钱蛋白排,你不用再拍。价格可能已经变了,数字也没经过你核对;和你已存的地方同名的会被更新。
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setPhase({ kind: "input" })} className="btn-secondary flex-1 py-3">
              不用了
            </button>
            <button onClick={() => acceptIncoming(phase.menus)} className="btn-primary flex-[2] py-3" data-testid="accept-incoming">
              存下来
            </button>
          </div>
        </div>
      )}

      {toast && (
        <p className="fixed inset-x-0 bottom-24 z-30 mx-auto w-fit max-w-[90%] rounded-full bg-ink-900 px-4 py-2 text-center text-sm text-white shadow-lg rise" role="status">
          {toast}
        </p>
      )}

      {phase.kind === "saved" && (
        <FeedbackCard feedback={phase.feedback} currency={currency} onDone={() => router.push("/")} onMore={another} />
      )}
    </div>
  );
}

/** Hidden file input; wrapped in a <label> so taps open the camera without JS click(). */
function PhotoInput({
  type,
  onFile,
  capture = true,
  testId,
}: {
  type: PhotoType;
  onFile: (t: PhotoType, f: File) => void;
  capture?: boolean; // false = pick an existing image (a screenshot) instead of opening the camera
  testId?: string;
}) {
  return (
    <input
      type="file"
      accept="image/*"
      capture={capture ? "environment" : undefined}
      className="hidden"
      data-testid={testId ?? `input-${type}`}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(type, f);
        e.target.value = "";
      }}
    />
  );
}
