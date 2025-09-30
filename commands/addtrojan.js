// commands/addtrojan.js
const { createAddWsPlugin } = require('../lib/addBaseWS');

module.exports = createAddWsPlugin({
  name: 'addtrojan',
  aliases: ['add-trojan'],
  title: 'Tambah Akun Trojan',
  commandTpl: '/usr/local/sbin/addtr {USER} {EXP}',
  expMode: 'days'
});
