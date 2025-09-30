// lib/owner.js
// Sumber kebenaran tunggal untuk daftar owner

// <<< GANTI daftar ini sesuai kebutuhanmu
const OWNERS = ['5736569839']; // id Telegram kamu (string), bisa lebih dari satu

function parseOwnerIds() {
  return OWNERS.slice(); // salin aman
}

function isOwnerMsg(msgOrQuery) {
  const uid = String(msgOrQuery?.from?.id ?? '');
  return parseOwnerIds().includes(uid);
}

module.exports = { parseOwnerIds, isOwnerMsg };
