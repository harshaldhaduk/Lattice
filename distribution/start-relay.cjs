const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(process.env.LATTICE_DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(directory, {recursive: true, mode: 0o700});
if (!process.env.LATTICE_STORAGE_KEY) {
  const keyFile = path.join(directory, 'storage.key');
  try { fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), {flag: 'wx', mode: 0o600}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  process.env.LATTICE_STORAGE_KEY = fs.readFileSync(keyFile, 'utf8').trim();
}
process.env.LATTICE_DATA_DIR = directory;
process.env.HOST ||= '0.0.0.0';
process.env.PORT ||= '4329';
console.log('Lattice test relay. Keep this terminal running. Use a private LAN or VPN; this launcher does not configure public internet TLS.');
require('./relay.cjs');
