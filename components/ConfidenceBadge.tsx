import type { Confidence, Source } from "@/lib/types";

export const CONF_LABEL: Record<Confidence, string> = { high: "高", medium: "中", low: "低" };

/** PRD: high = solid border; medium/low = dashed border. */
export function confidenceBorder(conf: Confidence | null): string {
  return conf === "high" ? "border-2 border-solid border-brand-500" : "border-2 border-dashed border-ink-200";
}

// One label per data tier so the user can see where a number came from.
const SOURCE_STYLE: Record<Source, { label: string; cls: string }> = {
  official_table: { label: "官方数据", cls: "bg-brand-100 text-brand-700" },
  dining_menu: { label: "食堂菜单", cls: "bg-dining-100 text-dining-700" },
  reference_table: { label: "参考数据·未核实", cls: "bg-sky-100 text-sky-800" },
  visual_estimate: { label: "目测估算", cls: "bg-ink-100 text-ink-600" },
  text_estimate: { label: "目测估算", cls: "bg-ink-100 text-ink-600" },
};

export default function ConfidenceBadge({
  confidence,
  source,
}: {
  confidence: Confidence | null;
  source: Source | null;
}) {
  if (!confidence) return null;
  const s = SOURCE_STYLE[source ?? "visual_estimate"] ?? SOURCE_STYLE.visual_estimate;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${s.cls}`}>
      {s.label} · 置信度{CONF_LABEL[confidence]}
    </span>
  );
}
