// commands/trialtrojan.js
const { createTrialPlugin } = require('../lib/trialBase');
// Sesuaikan: trialtrojan / trial-trojan
module.exports = createTrialPlugin({
  name: 'trialtrojan',
  aliases: ['trialtr'],
  title: 'Trial Trojan',
  commandTpl: `printf "%s\\n" "{MIN}" | trialtrojan`,
  minutes: 60
});
