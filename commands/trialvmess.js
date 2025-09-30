// commands/trialvmess.js
const { createTrialPlugin } = require('../lib/trialBase');
// Sesuaikan nama command VPS (mis. trialvmess / trial-vmess)
module.exports = createTrialPlugin({
  name: 'trialvmess',
  aliases: ['trialvm'],
  title: 'Trial VMess',
  commandTpl: `printf "%s\\n" "{MIN}" | trialws`,
  minutes: 60
});
