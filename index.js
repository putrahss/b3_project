// index.js — Telegram bot (polling) + loader plugin + support sesi (+ auto-register user)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
// Simpan waktu start bot untuk perhitungan uptime
global.__BOT_STARTED_AT = Date.now();
// === QRIS CONFIG (jangan commit ke repo publik) ===
global.qrisConfig = {
  username: "andyyuda",
  token: "2281842:kxESftnCA3289oadUg6Lv5G4pehPsHmB",
  baseurl: "https://api.klmpk.web.id",
  apikey: "350320017391806652281842OKCT042A39DC0D7F3091CCC8D2AEB5D03B39",
  merchant: "OK2281842",
  codeqr: "00020101021226670016COM.NOBUBANK.WWW01189360050300000879140214033293894066650303UMI51440014ID.CO.QRIS.WWW0215ID20253827872030303UMI520454115303360540410005802ID5921KLMPK STORE OK22818426006BLITAR61056611362070703A016304E3FA"
};

// ===== Token: .env atau hardcode fallback =====
const HARDCODED_TOKEN = '6367951330:AAEsYaDktE-lztbYQCmzb6vTg9N4b1Ma10g';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || HARDCODED_TOKEN;
if (!TOKEN || TOKEN === 'PUT_YOUR_BOT_TOKEN_HERE') {
  console.error('❌ Token tidak tersedia. Set .env TELEGRAM_BOT_TOKEN=... ATAU isi HARDCODED_TOKEN.');
  process.exit(1);
}

// === Owner helper (hardcode di lib/owner.js)
const { parseOwnerIds, isOwnerMsg } = require('./lib/owner');

// ====== SQLITE: wallet.db (auto-register user) ======
const DB_PATH = path.resolve(process.cwd(), 'andy', 'wallet.db');
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
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (tg_id, name, balance, created_at)
  VALUES (@tg_id, @name, 0, @created_at)
  ON CONFLICT(tg_id) DO UPDATE SET name = COALESCE(excluded.name, users.name)
`);
function fullName(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(' ')
      || u?.username
      || 'User';
}
function ensureUser(msg) {
  if (!msg?.from?.id) return;
  const tg_id = String(msg.from.id);
  const name  = fullName(msg.from);
  stmtUpsertUser.run({ tg_id, name, created_at: new Date().toISOString() });
}

// ====== BOT ======
const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅ Bot polling...');

// ===== Loader plugin =====
const COMMANDS_DIR = path.resolve(__dirname, 'commands');
const commandMap = new Map();
const aliasMap   = new Map();

function loadCommands() {
  if (!fs.existsSync(COMMANDS_DIR)) fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js'));
  let count = 0;

  global.__registeredPlugins ??= Object.create(null);

  for (const file of files) {
    const full = path.join(COMMANDS_DIR, file);
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      if (!mod?.name || typeof mod.execute !== 'function') {
        console.warn(`⚠️ Skip ${file} (tidak export {name, execute})`);
        continue;
      }
      const name = String(mod.name).toLowerCase();

      commandMap.set(name, mod);
      if (Array.isArray(mod.aliases)) {
        for (const a of mod.aliases) aliasMap.set(String(a).toLowerCase(), name);
      }
      count++;

      if (typeof mod.register === 'function' && !global.__registeredPlugins[name]) {
        try {
          mod.register(bot);
          global.__registeredPlugins[name] = true;
          console.log(`   ↳ registered: ${name}`);
        } catch (e) {
          console.error(`   ↳ register error (${name}):`, e?.message || e);
        }
      }
    } catch (e) {
      console.error(`❌ Gagal load plugin ${file}:`, e?.message || e);
    }
  }
  console.log('🔌 Command termuat:', count);
}
loadCommands();

// ===== Parser command (prefix "/" & ".") =====
function parseCommand(text = '') {
  const t = (text || '').trim();
  if (!t) return null;
  if (!(t.startsWith('/') || t.startsWith('.'))) return null;
  const cut = t.slice(1);
  const [cmdRaw, ...args] = cut.split(/\s+/);
  const base = String(cmdRaw || '').split('@')[0].toLowerCase();
  return { cmd: base, args };
}

// ===== Router utama =====
bot.on('message', async (msg) => {
  try {
    // **AUTO-REGISTER USER** di awal setiap pesan
    ensureUser(msg);

    const text = msg.text || msg.caption || '';
    if (!text) return;

    console.log(`[msg] chat:${msg.chat.id} from:${msg.from.id} @${msg.from.username || '-'}: ${text}`);

    // Admin-only /reload
    if (/^\/reload$/i.test(text)) {
      if (!isOwnerMsg(msg)) return bot.sendMessage(msg.chat.id, '❌ Command ini hanya untuk owner.');
      for (const k of commandMap.keys()) commandMap.delete(k);
      for (const k of aliasMap.keys()) aliasMap.delete(k);
      loadCommands();
      return bot.sendMessage(msg.chat.id, '✅ Commands di-reload.');
    }

    // 1) Command ber-prefix
    const parsed = parseCommand(text);
    if (parsed) {
      const name = commandMap.has(parsed.cmd) ? parsed.cmd : aliasMap.get(parsed.cmd);
      if (!name) return;
      const plugin = commandMap.get(name);
      return await plugin.execute(bot, msg, parsed.args);
    }

    // 2) Pesan non-prefix → teruskan ke plugin berbasis sesi
    const sessionPlugins = [
      'trialssh','trialvmess','trialvless','trialtrojan',
      'addssh','addvmess','addvless','addtrojan',
      'topup','ceksaldo','admin'
    ];
    for (const n of sessionPlugins) {
      const p = commandMap.get(n);
      if (p && typeof p.continue === 'function') {
        const handled = await p.continue(bot, msg);
        if (handled) return;
      }
    }

  } catch (e) {
    console.error('❌ Error handler:', e);
    try { await bot.sendMessage(msg.chat.id, '❌ Terjadi kesalahan.'); } catch {}
  }
});

// ===== /start & /help default =====
bot.onText(/^\/start$/i, async (msg) => {
  ensureUser(msg); // auto-register juga saat /start
  const first = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ')
              || msg.from.username || 'teman';
  await bot.sendMessage(msg.chat.id, `Halo ${first}! 👋\nKetik /menu atau .menu untuk fitur.`);
});

bot.onText(/^\/help$/i, async (msg) => {
  ensureUser(msg);
  await bot.sendMessage(msg.chat.id, '• /menu — menu bot\n• /reload — reload plugin (owner)');
});

// ===== Info bot =====
bot.getMe()
  .then(me => {
    console.log(`🤖 Login sebagai @${me.username} (id: ${me.id})`);
    console.log('OWNER_ID(s):', parseOwnerIds().join(', '));
  })
  .catch(err => console.error('❌ getMe error:', err?.message || err));
