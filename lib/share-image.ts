// Renders the weekly report as a 1080×1350 PNG (feed-friendly 4:5) on a canvas.
// Client only. Returns a Blob so the page can navigator.share() it or download it.
import { fmtDate } from "./dates";
import { cpgUnit, fmtMoney, type Currency } from "./money";
import type { WeeklyReport } from "./weekly";

const W = 1080;
const H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

export async function renderWeeklyShareImage(report: WeeklyReport, targetG: number, currency: Currency): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持画布");

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#f5f7f4");
  bg.addColorStop(1, "#e9efe9");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = "#15803d";
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText("蛋白钱包 · 周报", 72, 110);
  ctx.fillStyle = "#8a948f";
  ctx.font = `400 30px ${FONT}`;
  const range = `${fmtDate(report.weekStart)} – ${fmtDate(new Date(report.weekEnd.getTime() - 1))}`;
  ctx.fillText(range, 72, 158);

  // hero card
  const hero = ctx.createLinearGradient(72, 200, 1008, 520);
  hero.addColorStop(0, "#15803d");
  hero.addColorStop(1, "#2fb56f");
  rr(ctx, 72, 200, 936, 330, 40);
  ctx.fillStyle = hero;
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText("本周花销", 120, 266);
  ctx.fillText("蛋白达标", 580, 266);
  ctx.fillStyle = "#fff";
  ctx.font = `700 76px ${FONT}`;
  ctx.fillText(fmtMoney(report.spend, currency), 120, 352);
  ctx.fillText(`${report.daysMet} 天`, 580, 352);
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(`预算 ${fmtMoney(report.budget, currency)}`, 120, 404);
  ctx.fillText(`${report.daysRecorded} 天有记录 · 目标 ${targetG} g/天`, 580, 404);
  if (report.avgCpg != null) {
    ctx.fillStyle = "#fff";
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText(`本周每克蛋白质平均 ${report.avgCpg.toFixed(1)} ${cpgUnit(currency)}`, 120, 480);
  }

  // ranking
  ctx.fillStyle = "#16201b";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("蛋白质单价排行榜", 72, 620);
  ctx.fillStyle = "#8a948f";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(`${cpgUnit(currency)},越低越划算`, 72 + ctx.measureText("蛋白质单价排行榜").width + 420, 620);

  const rows = report.ranking.slice(0, 5);
  const maxCpg = Math.max(...rows.map((r) => r.cpg), 1);
  let y = 680;
  rows.forEach((r, i) => {
    rr(ctx, 72, y, 936, 104, 28);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.fillStyle = i === 0 ? "#15803d" : "#dfe5e1";
    ctx.beginPath();
    ctx.arc(130, y + 52, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = i === 0 ? "#fff" : "#4b5853";
    ctx.font = `700 28px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), 130, y + 62);
    ctx.textAlign = "left";
    ctx.fillStyle = "#16201b";
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText(clip(ctx, r.name, 440), 184, y + 48);
    ctx.fillStyle = "#8a948f";
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText(clip(ctx, `${r.merchant ?? "无商家"} · ${r.times} 次 · ${fmtMoney(r.amount, currency)} / 约 ${Math.round(r.proteinMid)} g`, 440), 184, y + 84);
    // bar
    const bw = 260 * (r.cpg / maxCpg);
    rr(ctx, 660, y + 38, 260, 14, 7);
    ctx.fillStyle = "#eef1ee";
    ctx.fill();
    rr(ctx, 660, y + 38, Math.max(14, bw), 14, 7);
    ctx.fillStyle = i === 0 ? "#1f9d5a" : "#a9dcbd";
    ctx.fill();
    ctx.fillStyle = "#16201b";
    ctx.font = `700 34px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`${r.cpg.toFixed(1)}`, 992, y + 66);
    ctx.textAlign = "left";
    y += 120;
  });
  if (rows.length === 0) {
    ctx.fillStyle = "#8a948f";
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText("本周还没有带金额和蛋白质的记录", 72, 720);
  }

  // footer
  ctx.fillStyle = "#8a948f";
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(report.delta, 72, H - 120);
  ctx.fillStyle = "#15803d";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText("每一块钱换到多少克蛋白质 · protein-wallet.vercel.app", 72, H - 64);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("生成图片失败"))), "image/png");
  });
}
