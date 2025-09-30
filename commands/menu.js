// commands/menu.js
// Menu tombol utama + Header bergaya kartu + Status VPS + callback (+ Admin utk OWNER)

const fs   = require('fs');
const net  = require('net');
const path = require('path');
const Database = require('better-sqlite3');
const { isOwnerMsg } = require('../lib/owner');

// ====== KONFIG (ganti sesuai brandmu) ======
const BRAND_NAME   = 'JULAK VPN';
const STORE_NAME   = 'PAPADAAN-STORE';
const CONTACT_ADM  = '@rajaganjil93'; // ganti sesuai handle admin

// ====== DB helpers (wallet.db) ======
const DB_PATH = path.resolve(process.cwd(), 'julak', 'wallet.db');
function openDB() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        tg_id TEXT PRIMARY KEY,
        name  TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    // purchase_logs opsional; jika belum ada, statistik = 0
    try {
      db.prepare(`SELECT 1 FROM purchase_logs LIMIT 1`).get();
    } catch {
      // diam saja; nanti query statistik dibungkus try/catch
    }
    return db;
  } catch {
    return null;
  }
}
const db = openDB();

function getSaldo(tgId) {
  try {
    if (!db) return 0;
    const row = db.prepare(`SELECT balance FROM users WHERE tg_id=?`).get(String(tgId));
    return Number(row?.balance || 0);
  } catch { return 0; }
}
function countUsers() {
  try {
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get();
    return Number(row?.n || 0);
  } catch { return 0; }
}

// ====== WIB helpers ======
function wibNow() {
  // konversi ke WIB (UTC+7) tanpa mengubah jam sistem
  const now = new Date();
  return new Date(now.getTime() + 7*60*60*1000);
}
function startEndOfDayWIB(dateWIB = wibNow()) {
  const d = new Date(dateWIB);
  d.setUTCHours(0,0,0,0);
  const start = new Date(d);
  const end   = new Date(d.getTime() + 24*60*60*1000);
  return { start, end };
}
function startEndOfWeekWIB(dateWIB = wibNow()) {
  // minggu dimulai Senin (ISO)
  const d = new Date(dateWIB);
  const day = (d.getUTCDay() + 6) % 7; // 0=Senin
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - day);
  start.setUTCHours(0,0,0,0);
  const end = new Date(start.getTime() + 7*24*60*60*1000);
  return { start, end };
}
function startEndOfMonthWIB(dateWIB = wibNow()) {
  const d = new Date(dateWIB);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0,0,0));
  const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0,0,0));
  return { start, end };
}

// Konversi objek Date (WIB-virtual) ke ISO UTC string supaya sejalan dengan kolom created_at
function toISO(d) { return new Date(d.getTime() - 7*60*60*1000).toISOString(); }

// ====== Statistik dari purchase_logs ======
function getUserStats(tgId) {
  const zero = { day: 0, week: 0, month: 0 };
  if (!db) return zero;
  try {
    // pastikan tabel ada
    db.prepare(`SELECT 1 FROM purchase_logs LIMIT 1`).get();
  } catch { return zero; }

  const { start: dS, end: dE } = startEndOfDayWIB();
  const { start: wS, end: wE } = startEndOfWeekWIB();
  const { start: mS, end: mE } = startEndOfMonthWIB();

  const q = `SELECT COUNT(*) AS n FROM purchase_logs WHERE tg_id=? AND created_at>=? AND created_at<?`;
  const day  = db.prepare(q).get(String(tgId), toISO(dS), toISO(dE))?.n || 0;
  const week = db.prepare(q).get(String(tgId), toISO(wS), toISO(wE))?.n || 0;
  const month= db.prepare(q).get(String(tgId), toISO(mS), toISO(mE))?.n || 0;
  return { day, week, month };
}
function getGlobalStats() {
  const zero = { day: 0, week: 0, month: 0 };
  if (!db) return zero;
  try {
    db.prepare(`SELECT 1 FROM purchase_logs LIMIT 1`).get();
  } catch { return zero; }

  const { start: dS, end: dE } = startEndOfDayWIB();
  const { start: wS, end: wE } = startEndOfWeekWIB();
  const { start: mS, end: mE } = startEndOfMonthWIB();

  const q = `SELECT COUNT(*) AS n FROM purchase_logs WHERE created_at>=? AND created_at<?`;
  const day  = db.prepare(q).get(toISO(dS), toISO(dE))?.n || 0;
  const week = db.prepare(q).get(toISO(wS), toISO(wE))?.n || 0;
  const month= db.prepare(q).get(toISO(mS), toISO(mE))?.n || 0;
  return { day, week, month };
}

// ====== VPS status ======
function checkPort(host, port = 22, timeout = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        try { sock.destroy(); } catch {}
        resolve(ok);
      }
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error',  () => done(false));
    try { sock.connect(port, host); } catch { done(false); }
  });
}
function loadVpsList() {
  const vpsPath = path.resolve(process.cwd(), 'julak', 'vps.json');
  if (!fs.existsSync(vpsPath)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(vpsPath, 'utf-8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
async function getVpsStatuses() {
  const list = loadVpsList();
  const results = await Promise.all(
    list.map(async (v) => {
      const host = v.host;
      const port = v.port || 22;
      const ok   = host ? await checkPort(host, port) : false;
      const name = v.name || v.id || (host ? `${host}:${port}` : 'unknown');
      return { name, online: ok };
    })
  );
  return { results, count: list.length };
}

// ====== Waktu, tanggal, uptime ======
const idr = (n) => Number(n||0).toLocaleString('id-ID');
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  return `${d}d ${h}h ${m}m`;
}
function nowJakarta() {
  const wib = wibNow();
  const pad = (n)=>String(n).padStart(2,'0');
  const hh = pad(wib.getUTCHours());
  const mm = pad(wib.getUTCMinutes());
  const ss = pad(wib.getUTCSeconds());
  const dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const dname = dayNames[wib.getUTCDay()];
  const date  = `${dname}, ${wib.getUTCDate()} ${monthNames[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
  return { time: `${hh}:${mm}:${ss} WIB`, date };
}
function getUptimeSec() {
  const started = Number(global.__BOT_STARTED_AT || 0);
  if (started > 0) return Math.floor((Date.now() - started) / 1000);
  // fallback kalau global belum diset
  return Math.floor(process.uptime());
}

function fmtUptime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  return `${d}d ${h}h ${m}m`;
}
// ====== Header kartu ======
async function buildHeaderText(msg) {
  const uid = msg.from?.id;
  const uname = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || 'User');
  const saldo = getSaldo(uid);
  const uptime = fmtUptime(getUptimeSec());
  const { count: vpsCount } = await getVpsStatuses();
  const totalUsers = countUsers();

  const meStat = getUserStats(uid);
  const glStat = getGlobalStats();
  const { time, date } = nowJakarta();

  return [
'━━━━━━━━━━━━━━━━━━━━━━━━',
`Selamat datang di ${BRAND_NAME} 🚀`,
'Bot otomatis untuk membeli Akun VPN dengan mudah dan cepat.',
'━━━━━━━━━━━━━━━━━━━━━━━━',
`💲 » Saldo: Rp.${idr(saldo)}`,
'━━━━━━━━━━━━━━━━━━━━━━━━',
`👤 » Status: Member`,
`🌐 » Username: ${uname}`,
`📋 » Your ID: ${uid}`,
`♻️ » Bot Aktif: ${uptime}`,
`✨ » Trial 2x Sehari`,
`🥇 » Support Wildcard & Enhanced`,
'━━━━━━━━━━━━━━━━━━━━━━━━',
`🧭 » Waktu: ${time}`,
`🏷️ » Tanggal: ${date}`,
`🏷️ » Server: ${vpsCount} |️ Total User: ${totalUsers}`,
`☎️ » Contact Admin: ${CONTACT_ADM}`,
'━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
}

// ====== Teks status VPS & seksi fitur ======
async function buildMenuBody() {
  const { results } = await getVpsStatuses();
  const statusLines = results.length
    ? results.map(s => `${s.online ? '🟢' : '🔴'} ${s.name}`)
    : ['_Tidak ada VPS terdaftar._'];

  const lines = [
    '',
    '*🧪 Trial Akun*',
    '• SSH, VMess, VLess, Trojan',
    '',
    '*➕ Add Akun (berbayar, potong saldo)*',
    '• SSH, VMess, VLess, Trojan',
    '',
    '*💰 Saldo*',
    '• Topup via QRIS (auto verif)',
    '• Cek Saldo',
    '',
    '*🖥️ Status VPS*',
    ...statusLines
  ];
  return lines.join('\n');
}

// ====== Keyboard ======
function buildKeyboard(isOwner) {
  const rows = [
    // Trial
    [
      { text: '🧪 Trial SSH',    callback_data: 'menu:run:trialssh' },
      { text: '🧪 Trial VMess',  callback_data: 'menu:run:trialvmess' }
    ],
    [
      { text: '🧪 Trial VLess',  callback_data: 'menu:run:trialvless' },
      { text: '🧪 Trial Trojan', callback_data: 'menu:run:trialtrojan' }
    ],
    // Add (berbayar)
    [
      { text: '➕ Add SSH',      callback_data: 'menu:run:addssh' },
      { text: '➕ Add VMess',    callback_data: 'menu:run:addvmess' }
    ],
    [
      { text: '➕ Add VLess',    callback_data: 'menu:run:addvless' },
      { text: '➕ Add Trojan',   callback_data: 'menu:run:addtrojan' }
    ],
    // Wallet
    [
      { text: '💰 Topup QRIS',   callback_data: 'menu:run:topup' },
      { text: '💳 Cek Saldo',    callback_data: 'menu:run:ceksaldo' }
    ]
  ];
  if (isOwner) rows.push([{ text: '🛡 Admin', callback_data: 'menu:run:admin' }]);
  rows.push([{ text: '🔄 Refresh Menu', callback_data: 'menu:run:refresh' }]);
  return { inline_keyboard: rows };
}

// ====== Safe require plugins ======
function safeRequire(p) { try { return require(p); } catch { return null; } }
const pTrialSSH    = safeRequire('./trialssh');
const pTrialVMESS  = safeRequire('./trialvmess');
const pTrialVLESS  = safeRequire('./trialvless');
const pTrialTROJAN = safeRequire('./trialtrojan');
const pAddSSH    = safeRequire('./addssh');
const pAddVMESS  = safeRequire('./addvmess');
const pAddVLESS  = safeRequire('./addvless');
const pAddTROJAN = safeRequire('./addtrojan');
const pTOPUP  = safeRequire('./topup');
const pSALDO  = safeRequire('./ceksaldo');
const pADMIN  = safeRequire('./admin');

module.exports = {
  name: 'menubutton',
  aliases: ['menu','help'],
  description: 'Menu tombol utama + Header kartu + Status VPS + jalankan plugin',

  async execute(bot, msg) {
    try {
      const header = await buildHeaderText(msg);
      const body   = await buildMenuBody();
      const text   = `${header}\n${body}`;
      const kb     = buildKeyboard(isOwnerMsg(msg));

      await bot.sendMessage(msg.chat.id, text || '*Menu*', {
        parse_mode: 'Markdown',
        reply_markup: kb
      });
    } catch (e) {
      console.error('[menu] execute error:', e?.message || e);
      try { await bot.sendMessage(msg.chat.id, '❌ Gagal menampilkan menu.'); } catch {}
    }
  },

  register(bot) {
    if (bot.__menubutton_registered) return;
    bot.__menubutton_registered = true;

    bot.on('callback_query', async (q) => {
      try {
        const data = q.data || '';
        if (!data.startsWith('menu:run:')) return;

        const name   = data.slice('menu:run:'.length);
        const chatId = q.message?.chat?.id;
        const msgId  = q.message?.message_id;

        try { await bot.answerCallbackQuery(q.id); } catch {}

        if (name === 'refresh') {
          const header = await buildHeaderText(q.message);
          const body   = await buildMenuBody();
          const fresh  = `${header}\n${body}`;
          return bot.editMessageText(fresh || '*Menu*', {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: buildKeyboard(isOwnerMsg(q))
          });
        }

        if (name === 'admin' && !isOwnerMsg(q)) {
          return bot.sendMessage(chatId, '❌ Menu admin hanya untuk owner.');
        }

        const map = {
          trialssh:    pTrialSSH,
          trialvmess:  pTrialVMESS,
          trialvless:  pTrialVLESS,
          trialtrojan: pTrialTROJAN,
          addssh:      pAddSSH,
          addvmess:    pAddVMESS,
          addvless:    pAddVLESS,
          addtrojan:   pAddTROJAN,
          topup:       pTOPUP,
          ceksaldo:    pSALDO,
          admin:       pADMIN
        };
        const plugin = map[name];
        if (!plugin || typeof plugin.execute !== 'function') {
          return bot.sendMessage(chatId, '❌ Plugin tidak ditemukan / belum dipasang.');
        }

        try {
          await bot.editMessageText(`⏳ Menjalankan *${name}*…`, {
            chat_id: chatId, message_id: msgId, parse_mode: 'Markdown'
          });
        } catch {}

        // Fake message agar sesi milik user penekan tombol
        const fakeMsg = { ...q.message, chat: q.message.chat, from: q.from, text: '' };
        await plugin.execute(bot, fakeMsg, []);
      } catch (e) {
        console.error('[menu] callback error:', e?.message || e);
        try { await bot.sendMessage(q.message.chat.id, '❌ Terjadi kesalahan pada tombol.'); } catch {}
      }
    });
  }
};
