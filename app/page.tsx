"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Onboarding from "@/components/Onboarding";
import { getSettings, logEvent } from "@/lib/db";
import type { Settings } from "@/lib/types";

export default function Home() {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      void logEvent("page_open", { page: "today" });
    });
  }, []);

  if (settings === undefined) return <p className="py-8 text-zinc-500">加载中…</p>;
  if (settings === null) return <Onboarding onDone={setSettings} />;

  return (
    <div className="space-y-6 py-2">
      <h1 className="text-2xl font-bold">今日</h1>
      <p className="text-zinc-600">
        目标 {settings.protein_target_g} g/天,预算 ${settings.weekly_budget_usd}/周。差额卡片在 Step 1.6 实现。
      </p>
      <Link
        href="/log"
        className="block rounded-2xl bg-green-600 py-4 text-center text-lg font-semibold text-white shadow"
      >
        + 记一餐
      </Link>
    </div>
  );
}
