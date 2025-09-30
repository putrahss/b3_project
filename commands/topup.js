// commands/topupqris_sqlite.js
// Topup saldo via QRIS (Telegram) dengan better-sqlite3
// Node 18+ sudah punya fetch. Node 16: npm i node-fetch lalu global.fetch ||= require('node-fetch');
const path = require('path');
const Database = require('better-sqlite3');

// ====== Konfigurasi dari global atau ENV ======
function getConfig() {
  const g = global.qrisConfig || {};
  return {
    API_KEY: g.apikey    || process.env.QRIS_API_KEY   || '',
    CODE_QR: g.codeqr    || process.env.QRIS_CODE_QR   || '',
    USER    : g.username || process.env.QRIS_USER      || '',
    TOKEN   : g.token    || process.env.QRIS_TOKEN     || '',
    CREATE_URL: (g.baseurl || process.env.QRIS_BASEURL || 'https://api.klmpk.web.id')
                + '/orderkuota/createpayment',
    HISTORY_URL: g.history_url || process.env.QRIS_HISTORY_URL
                || 'https://orkutapi.andyyuda41.workers.dev/api/qris-history',
    MIN_TOPUP: Number(process.env.QRIS_MIN || 100)
  };
}

const DB_PATH = path.resolve(process.cwd(), 'julak', 'wallet.db');

// ====== DB & statements ======
function openDB() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_id TEXT PRIMARY KEY,
      name  TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qris_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT NOT NULL,
      expected_amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|expired|cancelled
      created_at TEXT NOT NULL,
      paid_at TEXT,
      raw_match TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qris_status ON qris_payments(status);
    CREATE INDEX IF NOT EXISTS idx_qris_tg ON qris_payments(tg_id);
  `);
  return db;
}
const db = openDB();

const nowISO = () => new Date().toISOString();
const idr = n => Number(n||0).toLocaleString('id-ID');
const skey = msg => `${msg.chat?.id}:${msg.from?.id}`;
const textOf = msg => String(msg.text || msg.caption || '').trim();
const send = (bot, chatId, text, opt={}) => bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opt });
const fullname = u => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || 'User';

// user helpers
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (tg_id, name, balance, created_at)
  VALUES (@tg_id, @name, 0, @created_at)
  ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name
`);
const stmtGetUser = db.prepare(`SELECT tg_id, name, balance FROM users WHERE tg_id = ?`);
const stmtAddBalance = db.prepare(`UPDATE users SET balance = balance + ? WHERE tg_id = ?`);

function ensureUser(msg) {
  const tg_id = String(msg.from.id);
  const name  = fullname(msg.from);
  stmtUpsertUser.run({ tg_id, name, created_at: nowISO() });
  return stmtGetUser.get(tg_id);
}

// payments helpers
const stmtCreatePayment = db.prepare(`
  INSERT INTO qris_payments (tg_id, expected_amount, status, created_at)
  VALUES (?, ?, 'pending', ?)
`);
const stmtGetPayment    = db.prepare(`SELECT * FROM qris_payments WHERE id = ?`);
const stmtApprovePay    = db.prepare(`
  UPDATE qris_payments SET status='approved', paid_at=?, raw_match=? WHERE id=? AND status='pending'
`);
const stmtExpirePay     = db.prepare(`
  UPDATE qris_payments SET status='expired', paid_at=? WHERE id=? AND status='pending'
`);

function stripAnsi(s='') { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

// ====== QRIS flow ======
async function startFlow(bot, msg) {
  const cfg = getConfig();
  if (!cfg.API_KEY || !cfg.CODE_QR || !cfg.USER || !cfg.TOKEN) {
    return send(bot, msg.chat.id, '❌ *QRIS belum dikonfigurasi.*\nSet `global.qrisConfig` atau ENV: `QRIS_API_KEY, QRIS_CODE_QR, QRIS_USER, QRIS_TOKEN`.');
  }
  ensureUser(msg);

  global.__qris_sessions ??= Object.create(null);
  const key = skey(msg);

  global.__qris_sessions[key] = { step: 1 };
  global.__qris_sessions[key].timeout = setTimeout(() => {
    if (global.__qris_sessions[key]) {
      delete global.__qris_sessions[key];
      send(bot, msg.chat.id, '⏳ Sesi topup dibatalkan karena tidak ada respons dalam 1 menit.');
    }
  }, 60_000);

  return send(bot, msg.chat.id,
    `💰 *TOPUP QRIS*\nMasukkan nominal (contoh: \`5000\`).\nMinimal: *Rp${cfg.MIN_TOPUP.toLocaleString('id-ID')}*\n\nKetik */batal* untuk membatalkan.`);
}

async function handleContinue(bot, msg) {
  const cfg = getConfig();
  global.__qris_sessions ??= Object.create(null);
  const key = skey(msg);
  const S = global.__qris_sessions[key];
  const t = textOf(msg);

  // batal kapan saja
  if (/^([./])?batal$/i.test(t)) {
    if (S) {
      clearInterval(S.timer); clearTimeout(S.timeout);
      delete global.__qris_sessions[key];
      return send(bot, msg.chat.id, '✅ Sesi topup dibatalkan.');
    }
    return send(bot, msg.chat.id, '❌ Tidak ada sesi topup yang aktif.');
  }

  if (!S) return false; // bukan sesi QRIS → biarkan handler lain

  if (S.step === 1) {
    const nominal = parseInt(t.replace(/[^\d]/g,''), 10);
    if (isNaN(nominal) || nominal < cfg.MIN_TOPUP) {
      await send(bot, msg.chat.id, `⚠️ Nominal tidak valid. Minimal *Rp${cfg.MIN_TOPUP.toLocaleString('id-ID')}*. Coba lagi.`);
      return true;
    }

    try {
      S.step = 2;
      S.nominal = nominal;

      // Buat record DB (pending) lebih dulu
      const info = stmtCreatePayment.run(String(msg.from.id), nominal, nowISO());
      S.paymentId = info.lastInsertRowid;

      // Request QR ke backend
      const createUrl = `${cfg.CREATE_URL}?` + new URLSearchParams({
        apikey: cfg.API_KEY,
        amount: String(nominal),
        codeqr: cfg.CODE_QR
      });
      const res = await fetch(createUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || json.status !== 'success') throw new Error(json?.message || 'Gagal membuat QRIS');

      const qrUrl = json.qr_code_url;
      const finalAmount = Number(json.amount || nominal);
      S.expect = finalAmount;

      await bot.sendPhoto(msg.chat.id, qrUrl, {
        caption:
`📥 *TOPUP QRIS*
• ID Pembayaran : #${S.paymentId}
• Nominal       : Rp${idr(nominal)}
• Total Transfer: *Rp${idr(finalAmount)}*

⚠️ Scan QR dan bayar *persis* nominal di atas.
⏳ Sistem mengecek otomatis hingga 5 menit.

Ketik */batal* untuk batalkan.`,
        parse_mode: 'Markdown'
      });

      const startTs = Date.now();
      S.timer = setInterval(async () => {
        try {
          const resp = await fetch(cfg.HISTORY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              username: cfg.USER,
              token: cfg.TOKEN,
              jenis: 'masuk'
            })
          });

          const raw = await resp.text();
          const blocks = String(raw || '').split('[#').filter(Boolean);

          let matched = null;
          for (const block of blocks) {
            const lines = block.split('\n').map(l => l.trim());
            let status = null, kredit = 0;
            for (const line of lines) {
              if (line.startsWith('Status')) status = line.split(':')[1]?.trim();
              if (line.startsWith('Kredit')) {
                const angka = (line.split(':')[1] || '').replace(/[^\d]/g, '');
                if (angka) kredit = parseInt(angka, 10);
              }
            }
            if (status === 'IN' && kredit === S.expect) { matched = block; break; }
          }

          if (matched) {
            clearInterval(S.timer); clearTimeout(S.timeout);

            // Double-protection di DB (transaksi)
            const tx = db.transaction(() => {
              const ok = stmtApprovePay.run(nowISO(), stripAnsi(matched), S.paymentId);
              if (ok.changes === 1) {
                // hanya kalau masih pending → approve + tambah saldo
                stmtAddBalance.run(S.expect, String(msg.from.id));
              }
            });
            tx();

            const u = stmtGetUser.get(String(msg.from.id));
            delete global.__qris_sessions[key];
            return send(bot, msg.chat.id,
              `✅ *Topup berhasil!*\n• ID: #${S.paymentId}\n• Tambahan: Rp${idr(S.expect)}\n• Saldo sekarang: *Rp${idr(u?.balance || 0)}*`);
          }

          if (Date.now() - startTs > 5 * 60_000) {
            clearInterval(S.timer);
          }
        } catch (e) {
          console.error('[QRIS CHECK] error:', e?.message || e);
        }
      }, 10_000);

      S.timeout = setTimeout(() => {
        if (global.__qris_sessions[key]) {
          clearInterval(S.timer);
          // mark expired di DB (best effort)
          try { stmtExpirePay.run(nowISO(), S.paymentId); } catch {}
          delete global.__qris_sessions[key];
          send(bot, msg.chat.id, '⏳ Waktu habis. Pembayaran tidak ditemukan. Silakan ulangi topup.');
        }
      }, 5 * 60_000);

      return true;
    } catch (err) {
      console.error('[topupqris_sqlite] create error:', err?.message || err);
      clearInterval(S.timer); clearTimeout(S.timeout);
      try { stmtExpirePay.run(nowISO(), S?.paymentId); } catch {}
      delete global.__qris_sessions[key];
      await send(bot, msg.chat.id, '❌ Gagal membuat QRIS. Coba lagi nanti.');
      return true;
    }
  }

  return true; // ada sesi → telan pesan
}

module.exports = {
  name: 'topup',
  aliases: ['topup', 'saldo-topup'],
  description: 'Topup saldo via QRIS (better-sqlite3) dengan verifikasi otomatis',
  async execute(bot, msg)   { return startFlow(bot, msg); },
  async continue(bot, msg)  { return handleContinue(bot, msg); }
};
