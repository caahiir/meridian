// Wallet quality tracker (tambahan Shahir/C): rekod hasil setiap signal ikut
// smart wallet, dan hantar amaran Telegram bila wallet yang sama terlibat
// dalam signal yang ditolak berulang kali. Fail data: wallet-quality.json.
import fs from "node:fs";
import { repoPath } from "../repo-root.js";
import { listSmartWallets } from "../smart-wallets.js";

const FILE = repoPath("wallet-quality.json");
const ALERT_EVERY = 2; // amaran pada 2, 4, 6... penolakan

const PASSED = ["shadow proposal recorded", "entered"];
// Bukan salah wallet: keadaan bot/akaun sendiri.
const NEUTRAL = ["portfolio full", "insufficient spendable SOL", "mint already attempted", "deploy failed", "position read unavailable", "error:", "no attempt"];

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { wallets: {} }; }
}
function save(data) {
  try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch {}
}
export function reasonKey(reason = "") {
  const r = String(reason).replace(/^blocked:\s*/, "");
  const m = r.match(/^([A-Za-z_]+)\s+failed/);
  if (m) return m[1];
  return r.split("(")[0].trim().slice(0, 60) || "unknown";
}
function nameOf(address) {
  try { return listSmartWallets().wallets.find(w => w.address === address)?.name || address.slice(0, 6); } catch { return address.slice(0, 6); }
}

// Pulangkan senarai mesej amaran (kosong jika tiada).
export function recordSignalOutcome(signal, reason, now = Date.now()) {
  const text = String(reason || "");
  // Data yang tidak dapat dibaca (contoh "volume outside limits or unknown")
  // bukan bukti wallet itu lemah, jadi dikira neutral.
  const dataUnknown = /\bunknown\b|unavailable/i.test(text);
  const outcome = PASSED.some(p => text.startsWith(p)) ? "passed" : (dataUnknown || NEUTRAL.some(p => text.startsWith(p))) ? "neutral" : "rejected";
  const data = load();
  const alerts = [];
  const key = reasonKey(text);
  for (const e of signal.events || []) {
    const w = (data.wallets[e.wallet] ||= { signals: 0, passed: 0, rejected: 0, neutral: 0, reasons: {}, lastAlertAt: 0, history: [] });
    w.signals++; w[outcome]++;
    if (outcome === "rejected") w.reasons[key] = (w.reasons[key] || 0) + 1;
    w.history = [...w.history, { at: now, mint: signal.mint, outcome, reason: text.slice(0, 120) }].slice(-20);
    if (outcome === "rejected" && w.rejected >= ALERT_EVERY && w.rejected - w.lastAlertAt >= ALERT_EVERY) {
      w.lastAlertAt = w.rejected;
      const reasons = Object.entries(w.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", ");
      alerts.push(`⚠️ Amaran smart wallet\n${nameOf(e.wallet)} (${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)})\nTerlibat dalam ${w.rejected} signal DITOLAK (lulus: ${w.passed}, jumlah: ${w.signals})\nSebab: ${reasons}\nPertimbangkan buang wallet ini dari senarai.`);
    }
  }
  save(data);
  return alerts;
}
