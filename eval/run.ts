// Eval runner: reads eval/samples/truth.json, calls the SAME estimate() the app
// uses, and prints the metric table from the PRD. Run with `npm run eval`.
import fs from "node:fs";
import path from "node:path";
import { estimate, postProcess, ESTIMATE_MODEL } from "../lib/estimate/estimate";
import { mockModelOutput } from "../lib/estimate/mock";
import { PROMPT_VERSION } from "../lib/estimate/prompt";
import { findChain } from "../lib/estimate/chains";
import type { EstimateInput, EstimateResponse } from "../lib/estimate/schema";
import type { Confidence } from "../lib/types";

interface Sample {
  id: string;
  type: EstimateInput["type"];
  set: "chain" | "aux";
  content?: string;
  file?: string;
  merchant: string | null;
  kcal: number;
  protein_g: number;
  amount_usd: number | null;
  items_count?: number;
  truth_source?: string;
}

interface Row {
  id: string;
  type: string;
  set: string;
  ok: boolean;
  error?: string;
  confidence?: Confidence;
  kcal: [number, number] | null;
  protein: [number, number] | null;
  truth_kcal: number;
  truth_protein: number;
  kcal_hit: boolean;
  protein_hit: boolean;
  kcal_width: number | null;
  protein_width: number | null;
  merchant_ok: boolean | null;
  amount_ok: boolean | null;
  items_ok: boolean | null;
  receipt_ok: boolean | null;
  ms: number;
}

const ROOT = path.resolve(process.cwd(), "eval");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only");
const note = flag("--log");
const from = flag("--from");
const concurrency = Number(flag("--concurrency") ?? 2);

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function toInput(s: Sample): EstimateInput {
  if (s.type === "text") return { type: "text", content: s.content ?? "" };
  const file = path.join(ROOT, "samples", s.file ?? "");
  const ext = path.extname(file).toLowerCase();
  const media_type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { type: s.type, content: fs.readFileSync(file).toString("base64"), media_type };
}

function score(s: Sample, r: EstimateResponse, ms: number): Row {
  const base: Row = {
    id: s.id, type: s.type, set: s.set, ok: r.ok, kcal: null, protein: null,
    truth_kcal: s.kcal, truth_protein: s.protein_g, kcal_hit: false, protein_hit: false,
    kcal_width: null, protein_width: null, merchant_ok: null, amount_ok: null, items_ok: null,
    receipt_ok: null, ms,
  };
  if (!r.ok) return { ...base, error: r.error };
  if (r.kind !== "meal") return { ...base, ok: false, error: "grocery response for a meal sample" };
  const kl = r.items.reduce((a, i) => a + i.kcal_low, 0);
  const kh = r.items.reduce((a, i) => a + i.kcal_high, 0);
  const pl = r.items.reduce((a, i) => a + i.protein_low_g, 0);
  const ph = r.items.reduce((a, i) => a + i.protein_high_g, 0);
  const conf = r.items.reduce<Confidence>((c, i) => (RANK[i.confidence] < RANK[c] ? i.confidence : c), "high");
  const width = (lo: number, hi: number) => (hi + lo > 0 ? (hi - lo) / ((hi + lo) / 2) : null);
  const truthChain = findChain(s.merchant);
  const gotChain = findChain(r.merchant);
  const merchant_ok =
    s.merchant == null ? r.merchant == null : truthChain ? gotChain?.merchant === truthChain.merchant
    : (r.merchant ?? "").toLowerCase().includes(s.merchant.toLowerCase());
  const gotAmount = r.total_usd ?? (r.items.length ? r.items.reduce((a, i) => a + (i.amount_usd ?? 0), 0) || null : null);
  const amount_ok = s.amount_usd == null ? gotAmount == null : gotAmount != null && Math.abs(gotAmount - s.amount_usd) < 0.011;
  const items_ok = s.items_count != null ? r.items.length === s.items_count : null;
  const receipt_ok = s.type === "receipt" ? merchant_ok && amount_ok && items_ok === true : null;
  return {
    ...base, confidence: conf, kcal: [kl, kh], protein: [pl, ph],
    kcal_hit: s.kcal >= kl && s.kcal <= kh, protein_hit: s.protein_g >= pl && s.protein_g <= ph,
    kcal_width: width(kl, kh), protein_width: width(pl, ph), merchant_ok, amount_ok, items_ok, receipt_ok,
  };
}

function pct(n: number, d: number) { return d ? `${((100 * n) / d).toFixed(0)}% (${n}/${d})` : "n/a"; }
function avg(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? `${((100 * v.reduce((a, b) => a + b, 0)) / v.length).toFixed(0)}%` : "n/a";
}

function report(rows: Row[]): string {
  const okRows = rows.filter((r) => r.ok);
  const by = (f: (r: Row) => boolean) => okRows.filter(f);
  const lines: string[] = [];
  lines.push(`| 指标 | 全部 | chain | aux |`);
  lines.push(`| --- | --- | --- | --- |`);
  const sets: [string, (r: Row) => boolean][] = [["全部", () => true], ["chain", (r) => r.set === "chain"], ["aux", (r) => r.set === "aux"]];
  const cell = (f: (rs: Row[]) => string) => sets.map(([, p]) => f(by(p))).join(" | ");
  lines.push(`| 蛋白质区间命中率 | ${cell((rs) => pct(rs.filter((r) => r.protein_hit).length, rs.length))} |`);
  lines.push(`| 热量区间命中率 | ${cell((rs) => pct(rs.filter((r) => r.kcal_hit).length, rs.length))} |`);
  lines.push(`| 蛋白区间相对宽度 (high) | ${cell((rs) => avg(rs.filter((r) => r.confidence === "high").map((r) => r.protein_width)))} |`);
  lines.push(`| 蛋白区间相对宽度 (medium) | ${cell((rs) => avg(rs.filter((r) => r.confidence === "medium").map((r) => r.protein_width)))} |`);
  lines.push(`| 蛋白区间相对宽度 (low) | ${cell((rs) => avg(rs.filter((r) => r.confidence === "low").map((r) => r.protein_width)))} |`);
  lines.push(`| 商家识别正确 | ${cell((rs) => pct(rs.filter((r) => r.merchant_ok).length, rs.length))} |`);
  lines.push(`| 金额正确 | ${cell((rs) => pct(rs.filter((r) => r.amount_ok).length, rs.length))} |`);
  const receipts = okRows.filter((r) => r.type === "receipt");
  lines.push(`| 小票解析准确率 | ${pct(receipts.filter((r) => r.receipt_ok).length, receipts.length)} | | |`);
  lines.push(`| 失败/错误样本 | ${rows.length - okRows.length}/${rows.length} | | |`);
  lines.push(`| 平均耗时 | ${(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length) / 1000).toFixed(1)}s | | |`);
  return lines.join("\n");
}

function detail(rows: Row[]): string {
  const f = (x: [number, number] | null) => (x ? `${x[0]}–${x[1]}` : "—");
  return [
    `| id | conf | 蛋白 (真值) | 命中 | 热量 (真值) | 命中 | 商家 | 金额 | 备注 |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...rows.map((r) =>
      `| ${r.id} | ${r.confidence ?? "—"} | ${f(r.protein)} (${r.truth_protein}) | ${r.protein_hit ? "✓" : "✗"} | ${f(r.kcal)} (${r.truth_kcal}) | ${r.kcal_hit ? "✓" : "✗"} | ${r.merchant_ok == null ? "—" : r.merchant_ok ? "✓" : "✗"} | ${r.amount_ok == null ? "—" : r.amount_ok ? "✓" : "✗"} | ${r.error ?? ""} |`),
  ].join("\n");
}

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); }
  }));
  return out;
}

async function main() {
  const samples: Sample[] = JSON.parse(fs.readFileSync(path.join(ROOT, "samples", "truth.json"), "utf8"));
  const picked = samples.filter((s) => s.type !== "grocery" && (!only || s.type === only));
  const mock = process.env.ESTIMATE_MOCK === "1";

  let rows: Row[];
  let label: string;
  if (from) {
    const cached = JSON.parse(fs.readFileSync(from, "utf8")) as { label: string; rows: Row[] };
    rows = cached.rows;
    label = `${cached.label} (recomputed from ${path.basename(from)})`;
  } else {
    if (!mock && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      console.error("ANTHROPIC_API_KEY is not set. Use ESTIMATE_MOCK=1 to dry-run or --from <results.json>.");
      process.exit(1);
    }
    label = `${mock ? "MOCK" : ESTIMATE_MODEL} · prompt ${PROMPT_VERSION}`;
    console.log(`Running ${picked.length} samples · ${label}\n`);
    rows = await mapLimit(picked, concurrency, async (s) => {
      const input = toInput(s);
      const t0 = Date.now();
      const r = mock ? postProcess(mockModelOutput(input), input) : await estimate(input);
      const row = score(s, r, Date.now() - t0);
      console.log(`${row.protein_hit ? "✓" : "✗"} ${s.id} ${row.error ? "ERROR " + row.error : `protein ${row.protein?.join("–")} (truth ${s.protein_g}) ${row.confidence}`}`);
      return row;
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(ROOT, "results", `${stamp}${mock ? "-mock" : ""}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ label, note, rows }, null, 2));
    console.log(`\nraw results -> ${path.relative(process.cwd(), outFile)}`);
  }

  const table = report(rows);
  console.log(`\n${table}\n\n${detail(rows)}`);

  if (note) {
    const entry = `\n## ${new Date().toISOString().slice(0, 10)} · ${label}\n\n${note}\n\n${table}\n`;
    fs.appendFileSync(path.join(ROOT, "log.md"), entry);
    console.log(`\nappended to eval/log.md`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
