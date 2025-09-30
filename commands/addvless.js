// commands/addvless.js
const { createAddWsPlugin } = require('../lib/addBaseWS');

module.exports = createAddWsPlugin({
  name: 'addvless',
  aliases: ['add-vless'],
  title: 'Tambah Akun VLess',
  commandTpl: '/usr/local/sbin/addvless {USER} {EXP}',
  expMode: 'days'
});
