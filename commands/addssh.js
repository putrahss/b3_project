// commands/addssh.js
const { createAddSshPlugin } = require('../lib/addBase');

// Sesuai formatmu:
// printf "%s\n" "<username>" "<password>" "2" "<exp>" | addssh
module.exports = createAddSshPlugin({
  name: 'addssh',
  aliases: ['add-ssh'],
  title: 'Tambah Akun SSH',
  commandTpl: `printf "%s\\n%s\\n%s\\n%s\\n" "{USER}" "{PASS}" "2" "{EXP}" | addssh`,
  // expMode: 'days'  // default 'days'; kalau butuh tanggal: set 'date'
});
