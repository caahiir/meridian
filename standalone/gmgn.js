// GMGN enrichment (tambahan Shahir/C): data keselamatan token dari GMGN
// OpenAPI (https://openapi.gmgn.ai) untuk menapis pool berisiko dan
// memaparkan ringkasan dalam mesej Telegram setiap signal.
//
// Aktif hanya bila GMGN_API_KEY ada dalam .env. Tanpa key, modul ini
// tidak buat apa-apa dan saringan asal yunus kekal seperti biasa.
// Laluan read-only sahaja (token/info, token/security); tiada private key.
import fs from "node:fs";
import crypto from "node:crypto";
import { repoPath } from "../repo-root.js";

const HOST = "https://openapi.gmgn.ai";
const TIMEOUT_MS = 8000;

// Had lalai; boleh diubah dalam user-config.json di bawah kunci "gmgnFilter".
const DEFAULTS = {
  enabled: true,
  maxRugRatio: 0.3,            // GMGN: > 0.3 = risiko tinggi
  maxBundlerTradeRate: 0.5,    // nisbah volume dari bot bundler
  maxRatTradeRate: 0.3,        // nisbah volume dari insider/rat trader
  maxInsiderHoldRate: 0.3,     // nisbah pegangan suspected insider
  rejectWashTrading: true,
  requireRenouncedMint: true,  // SOL: mint authority mesti renounced
  requireRenouncedFreeze: true,// SOL: freeze authority mesti renounced
};

export function gmgnSettings() {
  let u = {};
  try { u = JSON.parse(fs.readFileSync(repoPath("user-config.json"), "utf8")).gmgnFilter || {}; } catch {}
  return { ...DEFAULTS, ...u };
}

export function gmgnEnabled() {
  return Boolean(process.env.GMGN_API_KEY) && gmgnSettings().enabled !== false;
}

async function get(path, params, fetchImpl = fetch) {
  const q = new URLSearchParams({ ...params, timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${HOST}${path}?${q}`, {
      headers: { "X-APIKEY": process.env.GMGN_API_KEY, "Content-Type": "application/json", "User-Agent": "meridian-shahir/1.0" },
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || (json.code !== 0 && json.code !== "0")) {
      throw new Error(`GMGN ${path} ${res.status}${json?.code != null ? ` code=${json.code}` : ""}`);
    }
    return json.data ?? {};
  } finally { clearTimeout(t); }
}

const num = v => (v === "" || v == null || Number.isNaN(Number(v))) ? null : Number(v);

// Pulangkan ringkasan data GMGN, atau { error } jika gagal. Tidak pernah throw.
export async function fetchGmgn(mint, fetchImpl = fetch) {
  if (!gmgnEnabled()) return null;
  const [sec, info] = await Promise.allSettled([
    get("/v1/token/security", { chain: "sol", address: mint }, fetchImpl),
    get("/v1/token/info", { chain: "sol", address: mint }, fetchImpl),
  ]);
  if (sec.status === "rejected" && info.status === "rejected") return { error: sec.reason?.message || "GMGN tidak dapat dicapai" };
  const s = sec.status === "fulfilled" ? sec.value : {};
  const i = info.status === "fulfilled" ? info.value : {};
  const tags = i.wallet_tags_stat || {};
  return {
    securityOk: sec.status === "fulfilled",
    rugRatio: num(s.rug_ratio),
    washTrading: s.is_wash_trading === true || s.is_wash_trading === "true",
    renouncedMint: s.renounced_mint,
    renouncedFreeze: s.renounced_freeze_account,
    top10: num(s.top_10_holder_rate ?? i.stat?.top_10_holder_rate),
    insiderHold: num(s.suspected_insider_hold_rate),
    bundlerTrade: num(s.bundler_trader_amount_rate ?? i.stat?.top_bundler_trader_percentage),
    ratTrade: num(s.rat_trader_amount_rate ?? i.stat?.top_rat_trader_percentage),
    sniperCount: num(s.sniper_count ?? tags.sniper_wallets),
    smartWallets: num(tags.smart_wallets),
    kolWallets: num(tags.renowned_wallets),
    bundlerWallets: num(tags.bundler_wallets),
  };
}

// Pulangkan sebab penolakan (format "gmgn_xxx failed (...)") atau null jika lulus.
// Data yang tiada TIDAK dianggap selamat atau bahaya: syarat itu dilangkau.
export function gmgnVerdict(g, settings = gmgnSettings()) {
  if (!g || g.error || !g.securityOk) return null;
  const pct = v => `${(v * 100).toFixed(1)}%`;
  if (g.rugRatio != null && g.rugRatio > settings.maxRugRatio) return `gmgn_rug_ratio failed (${g.rugRatio.toFixed(2)} > ${settings.maxRugRatio})`;
  if (settings.rejectWashTrading && g.washTrading) return "gmgn_wash_trading failed (wash trading dikesan)";
  if (settings.requireRenouncedMint && g.renouncedMint === false) return "gmgn_mint_authority failed (mint belum renounced)";
  if (settings.requireRenouncedFreeze && g.renouncedFreeze === false) return "gmgn_freeze_authority failed (freeze belum renounced)";
  if (g.insiderHold != null && g.insiderHold > settings.maxInsiderHoldRate) return `gmgn_insider_hold failed (${pct(g.insiderHold)} > ${pct(settings.maxInsiderHoldRate)})`;
  if (g.bundlerTrade != null && g.bundlerTrade > settings.maxBundlerTradeRate) return `gmgn_bundler_trade failed (${pct(g.bundlerTrade)} > ${pct(settings.maxBundlerTradeRate)})`;
  if (g.ratTrade != null && g.ratTrade > settings.maxRatTradeRate) return `gmgn_rat_trade failed (${pct(g.ratTrade)} > ${pct(settings.maxRatTradeRate)})`;
  return null;
}

// Satu baris ringkas untuk Telegram.
export function gmgnLine(g) {
  if (!g) return "";
  if (g.error) return `GMGN: tiada data (${g.error})`;
  const f = (v, p) => v == null ? "-" : p ? `${(v * 100).toFixed(0)}%` : String(v);
  return `GMGN: rug ${g.rugRatio == null ? "-" : g.rugRatio.toFixed(2)} · smart ${f(g.smartWallets)} · KOL ${f(g.kolWallets)} · sniper ${f(g.sniperCount)} · bundler ${f(g.bundlerTrade, 1)} · top10 ${f(g.top10, 1)}`;
}
