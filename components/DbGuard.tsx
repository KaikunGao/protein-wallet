"use client";

import { useEffect, useState } from "react";
import { dbReady, onDbIssue } from "@/lib/db";

type State = "ok" | "blocked" | "slow" | "stale";
const SLOW_MS = 6000;

/**
 * Says so when the local database cannot be opened, instead of leaving every page on
 * "加载中…". The usual cause: after an update, an older copy of the app is still open in
 * another tab or as the home-screen app and blocks the upgrade. Closing it lets the open
 * request finish, and the notice goes away by itself.
 */
export default function DbGuard() {
  const [state, setState] = useState<State>("ok");

  useEffect(() => {
    let opened = false;
    const off = onDbIssue((issue) => setState(issue));
    const timer = setTimeout(() => {
      if (!opened) setState((s) => (s === "ok" ? "slow" : s));
    }, SLOW_MS);
    dbReady()
      .then(() => {
        opened = true;
        clearTimeout(timer);
        setState((s) => (s === "stale" ? s : "ok"));
      })
      .catch(() => setState("slow"));
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  if (state === "ok") return null;
  return (
    <div className="mb-4 rounded-2xl border-2 border-dashed border-dining-700/40 bg-dining-100 p-4 text-sm text-dining-700" role="alert" data-testid="db-guard">
      {state === "stale" ? (
        <p>
          <b>蛋白钱包在别的页面更新过了。</b>刷新一下这个页面再用。
        </p>
      ) : (
        <>
          <p>
            <b>数据打不开,页面会一直停在「加载中」。</b>
          </p>
          <p className="mt-1">
            多半是蛋白钱包还在别的标签页、或者主屏上的图标里开着旧版本。把它们全部关掉(手机上要从后台划掉),这里会自己恢复。你的记录都还在。
          </p>
        </>
      )}
      <button onClick={() => window.location.reload()} className="mt-3 rounded-lg bg-dining-700 px-3 py-1.5 text-xs font-medium text-white">
        刷新
      </button>
    </div>
  );
}
