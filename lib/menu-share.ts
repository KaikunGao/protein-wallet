// 菜单分享链接 (2026-11-04): a saved place travels inside the URL itself, so one person's
// scan serves a whole dorm without any server. The payload after `#m=` is compact JSON,
// deflated when the browser can, base64url-encoded. Everything decoded here is untrusted:
// it is validated field by field, bounded, and only ever rendered as text.
import type { MenuItem, SavedMenu } from "./menu-rank";
import type { Confidence, Source } from "./types";

export const SHARE_HASH_KEY = "m";
const VERSION = 1;
const MAX_PAYLOAD_CHARS = 60_000;
const MAX_JSON_BYTES = 300_000;
const MAX_MENUS = 12;
const MAX_DISHES = 40;
const MAX_NAME = 40;

const CONF: Confidence[] = ["low", "medium", "high"];
// Only the two sources a menu can produce travel; anything else is downgraded to an estimate.
const SRC: Record<string, Source> = { i: "ingredient_table", t: "text_estimate" };

/** What an incoming link carries: places not yet stored on this device. */
export interface IncomingMenu {
  name: string;
  scanned_ts: number; // when the sharer scanned it; prices may have changed since
  items: MenuItem[];
}

type Row = [string, number | null, number, number, number, number, number, string, number];
interface Wire { v: number; m: { n: string; t: number; d: Row[] }[] }

function toWire(menus: SavedMenu[]): Wire {
  return {
    v: VERSION,
    m: menus.slice(0, MAX_MENUS).map((m) => ({
      n: m.name.slice(0, MAX_NAME),
      t: m.shared_ts ?? m.ts,
      d: m.items.slice(0, MAX_DISHES).map((i): Row => [
        i.name.slice(0, MAX_NAME),
        i.price,
        i.protein_low_g,
        i.protein_high_g,
        i.kcal_low,
        i.kcal_high,
        Math.max(0, CONF.indexOf(i.confidence)),
        i.source === "ingredient_table" ? "i" : "t",
        i.side ? 1 : 0,
      ]),
    })),
  };
}

function num(x: unknown, max: number): number | null {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : null;
}

function fromWire(w: unknown): IncomingMenu[] | null {
  if (!w || typeof w !== "object") return null;
  const wire = w as Partial<Wire>;
  if (wire.v !== VERSION || !Array.isArray(wire.m)) return null;
  const out: IncomingMenu[] = [];
  for (const m of wire.m.slice(0, MAX_MENUS)) {
    if (!m || typeof m.n !== "string" || !Array.isArray(m.d)) return null;
    const name = m.n.trim().slice(0, MAX_NAME);
    if (!name) return null;
    const items: MenuItem[] = [];
    for (const r of m.d.slice(0, MAX_DISHES)) {
      if (!Array.isArray(r) || typeof r[0] !== "string") return null;
      const dish = r[0].trim().slice(0, MAX_NAME);
      const pl = num(r[2], 500), ph = num(r[3], 500), kl = num(r[4], 5000), kh = num(r[5], 5000);
      if (!dish || pl == null || ph == null || kl == null || kh == null || pl > ph || kl > kh) return null;
      const price = r[1] == null ? null : num(r[1], 10_000);
      if (r[1] != null && (price == null || price <= 0)) return null;
      const conf = CONF[typeof r[6] === "number" ? r[6] : -1];
      // A shared number was never checked by this user: it can be medium at most.
      const confidence: Confidence = conf === "low" || !conf ? "low" : "medium";
      const source = SRC[typeof r[7] === "string" ? r[7] : ""] ?? "text_estimate";
      items.push({
        id: String(items.length),
        name: dish,
        price,
        kcal_low: kl,
        kcal_high: kh,
        protein_low_g: pl,
        protein_high_g: ph,
        confidence,
        basis: "来自别人分享的菜单,数字是对方拍的时候估的;价格可能已经变了,自己重拍一次会更新",
        source,
        ...(r[8] === 1 ? { side: true } : {}),
      });
    }
    if (items.length === 0) return null;
    out.push({ name, scanned_ts: num(m.t, 4e12) ?? 0, items });
  }
  return out.length ? out : null;
}

// ---- bytes <-> base64url ----

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Run bytes through a (de)compression stream, giving up once the output passes `cap`. */
async function pump(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array | null> {
  try {
    const writer = stream.writable.getWriter();
    void writer.write(bytes as unknown as BufferSource).then(() => writer.close()).catch(() => undefined);
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        void reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** Payload for the URL hash: "z…" = deflated, "j…" = plain JSON (browsers without CompressionStream). */
export async function encodeMenus(menus: SavedMenu[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toWire(menus)));
  if (typeof CompressionStream !== "undefined") {
    const z = await pump(json, new CompressionStream("deflate-raw"), MAX_JSON_BYTES);
    if (z && z.length < json.length) return "z" + b64url(z);
  }
  return "j" + b64url(json);
}

/** Decode and validate a payload. Returns null for anything malformed, oversized or from another version. */
export async function decodeMenus(payload: string): Promise<IncomingMenu[] | null> {
  if (!payload || payload.length > MAX_PAYLOAD_CHARS) return null;
  const kind = payload[0];
  const bytes = unb64url(payload.slice(1));
  if (!bytes) return null;
  let json: Uint8Array | null = null;
  if (kind === "j") json = bytes.length <= MAX_JSON_BYTES ? bytes : null;
  else if (kind === "z" && typeof DecompressionStream !== "undefined") {
    json = await pump(bytes, new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);
  }
  if (!json) return null;
  try {
    return fromWire(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
  } catch {
    return null;
  }
}

export function shareUrl(origin: string, payload: string): string {
  return `${origin}/log?mode=menu#${SHARE_HASH_KEY}=${payload}`;
}

/** The payload in a location hash ("#m=…"), or null. */
export function payloadFromHash(hash: string): string | null {
  const m = hash.match(new RegExp(`[#&]${SHARE_HASH_KEY}=([^&]+)`));
  return m ? m[1] : null;
}
