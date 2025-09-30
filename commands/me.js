// commands/me.js
const path = require('path');
const Database = require('better-sqlite3');
const ownerUtil = require('../lib/owner'); // <= ganti

const { isOwnerMsg } = ownerUtil;
const ownerIdsText = ownerUtil.ownerIdsText || (() => {
  const raw = String(process.env.OWNER_ID || process.env.OWNER_IDS || '').replace(/['"]/g, '');
  const ids = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  return ids.length ? ids.join(', ') : '(none)';
});
