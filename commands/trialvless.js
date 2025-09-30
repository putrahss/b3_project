// commands/trialvless.js
const { createTrialPlugin } = require('../lib/trialBase');
// Sesuaikan: trialvless / trial-vless
module.exports = createTrialPlugin({
  name: 'trialvless',
  aliases: ['trialvl'],
  title: 'Trial VLess',
  commandTpl: `printf "%s\\n" "{MIN}" | trialvless`,
  minutes: 60
});
