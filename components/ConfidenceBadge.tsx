import type { Confidence, Source } from "@/lib/types";

export const CONF_LABEL: Record<Confidence, string> = { high: "高", medium: "中", low: "低" };

/** PRD: high = solid border + "官方数据"; medium/low = dashed border + "目测估算". */
export function confidenceBorder(conf: Confidence | null): string {
  return conf === "high" ? "border-2 border-solid border-green-600" : "border-2 border-dashed border-zinc-400";
}

export default function ConfidenceBadge({
  confidence,
  source,
}: {
  confidence: Confidence | null;
  source: Source | null;
}) {
  if (!confidence) return null;
  const official = source === "official_table";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
        official ? "bg-green-100 text-green-800" : "bg-zinc-100 text-zinc-600"
      }`}
    >
      {official ? "官方数据" : "目测估算"} · 置信度{CONF_LABEL[confidence]}
    </span>
  );
}
