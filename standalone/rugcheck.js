// RugCheck enrichment (tambahan Shahir/C): laporan risiko token dari
// RugCheck (https://api.rugcheck.xyz) — percuma, tiada API key.
// Digunakan untuk menapis token berisiko dan memaparkan ringkasan dalam
// mesej Telegram setiap signal. Boleh dimatikan melalui user-config.json:
//   "rugcheckFilter": { "enabled": false }
import fs from "node:fs";
import { repoPath } from "../repo-root.js";

const HOST = "https://api.rugcheck.xyz";
const TIMEOUT_MS = 8000;

const DEFAULTS = {
  enabled: true,
  // score_normalised: rendah = selamat. Tolak jika melebihi had ini.
  maxScore: 60,
  // Tolak jika ada risiko tahap "danger" yang namanya sepadan corak ini.
  dangerPatterns: ["mint authority", "freeze authority", "rugged", "honeypot", "copycat"],
};

export function rugcheckSettings() {
  let u = {};
  try { u = JSON.parse(fs.readFileSync(repoPath("user-config.json"), "utf8")).rugcheckFilter || {}; } catch {}
  return { ...DEFAULTS, ...u };
}

export function rugcheckEnabled() {
  return rugcheckSettings().enabled !== false;
}

// Pulangkan ringkasan, atau { error } jika gagal. Tidak pernah throw.
export async function fetchRugcheck(mint, fetchImpl = fetch) {
  if (!rugcheckEnabled()) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${HOST}/v1/tokens/${encodeURIComponent(mint)}/report/summary`, {
      headers: { "Accept": "application/json", "User-Agent": "meridian-shahir/1.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `RugCheck HTTP ${res.status}` };
    const j = await res.json().catch(() => null);
    if (!j || j.error) return { error: j?.error || "RugCheck: respons tidak sah" };
    const risks = Array.isArray(j.risks) ? j.risks.map(r => ({ name: String(r.name || ""), level: String(r.level || "").toLowerCase(), score: Number(r.score) || 0, value: r.value ?? "" })) : [];
    return {
      score: Number.isFinite(Number(j.score_normalised)) ? Number(j.score_normalised) : null,
      lpLockedPct: Number.isFinite(Number(j.lpLockedPct)) ? Number(j.lpLockedPct) : null,
      risks,
    };
  } catch (e) {
    return { error: e.name === "AbortError" ? "RugCheck tamat masa" : `RugCheck: ${e.message}` };
  } finally { clearTimeout(t); }
}

// Sebab penolakan (format "rugcheck_xxx failed (...)") atau null jika lulus.
// Data yang gagal dibaca tidak menghalang; saringan asal yunus tetap terpakai.
export function rugcheckVerdict(r, settings = rugcheckSettings()) {
  if (!r || r.error) return null;
  const pats = (settings.dangerPatterns || []).map(p => String(p).toLowerCase());
  const bad = r.risks.find(x => x.level === "danger" && pats.some(p => x.name.toLowerCase().includes(p)));
  if (bad) return `rugcheck_danger failed (${bad.name})`;
  if (r.score != null && r.score > settings.maxScore) return `rugcheck_score failed (${r.score} > ${settings.maxScore})`;
  return null;
}

export function rugcheckLine(r) {
  if (!r) return "";
  if (r.error) return `RugCheck: tiada data (${r.error})`;
  const danger = r.risks.filter(x => x.level === "danger").map(x => x.name);
  const warn = r.risks.filter(x => x.level === "warn").length;
  const parts = [`RugCheck: skor ${r.score ?? "-"}/100`];
  if (r.lpLockedPct != null) parts.push(`LP lock ${r.lpLockedPct.toFixed(0)}%`);
  parts.push(danger.length ? `⛔ ${danger.slice(0, 3).join(", ")}` : "tiada risiko bahaya");
  if (warn) parts.push(`${warn} amaran`);
  return parts.join(" · ");
}
