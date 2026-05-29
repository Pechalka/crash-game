// scripts/index.js
const fs = require('fs');
const path = require('path');

const placeBetScript = fs.readFileSync(path.join(__dirname, 'placeBet.lua'), 'utf8');
const cashOutScript = fs.readFileSync(path.join(__dirname, 'cashOut.lua'), 'utf8');

module.exports = { placeBetScript, cashOutScript };