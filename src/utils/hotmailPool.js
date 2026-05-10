/**
 * Hotmail Account Pool
 * 
 * Loads Hotmail accounts from .xlsx, .txt, or .csv files.
 * Each account: { email, password, refreshToken, clientId }
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function loadFromXlsx(filePath) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const accounts = [];
  for (const row of rows) {
    const keys = Object.keys(row);
    let email = findValue(row, keys, ['email', 'mail', 'e-mail']);
    let password = findValue(row, keys, ['pass', 'password', 'pwd']);
    let refreshToken = findValue(row, keys, ['refresh_token', 'refresh token', 'token', 'refresh']);
    let clientId = findValue(row, keys, ['client_id', 'client id', 'clientid', 'client']);

    // Auto-detect pipe-delimited data in refresh_token column
    // Format: EMAIL|PASS|REFRESH_TOKEN|CLIENT_ID
    const rtStr = String(refreshToken || '');
    if (rtStr.includes('|')) {
      const parts = rtStr.split('|').map(p => p.trim());
      if (parts.length >= 4) {
        email = parts[0] || email;
        password = parts[1] || password;
        refreshToken = parts[2];
        clientId = parts[3];
      } else if (parts.length === 3) {
        // Maybe EMAIL|REFRESH_TOKEN|CLIENT_ID
        refreshToken = parts[1];
        clientId = parts[2];
      }
    }

    if (!email || !refreshToken || !clientId) continue;

    accounts.push({
      email: String(email).trim(),
      password: String(password).trim(),
      refreshToken: String(refreshToken).trim(),
      clientId: String(clientId).trim(),
    });
  }

  return accounts;
}

function findValue(row, keys, candidates) {
  for (const candidate of candidates) {
    for (const key of keys) {
      if (key.toLowerCase().includes(candidate.toLowerCase())) {
        const val = row[key];
        if (val != null && String(val).trim()) return val;
      }
    }
  }
  return null;
}

function loadFromTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const accounts = [];

  for (const line of lines) {
    // Format: EMAIL|PASS|REFRESH_TOKEN|CLIENT_ID
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 4) continue;

    const [email, password, refreshToken, clientId] = parts;
    if (!email || !refreshToken || !clientId) continue;

    accounts.push({ email, password: password || '', refreshToken, clientId });
  }

  return accounts;
}

function loadFromCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) return [];

  const accounts = [];
  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 4) continue;

    const [email, password, refreshToken, clientId] = parts;
    if (!email || !refreshToken || !clientId) continue;

    accounts.push({ email, password: password || '', refreshToken, clientId });
  }

  return accounts;
}

function loadHotmailAccounts(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Hotmail accounts file not found: ' + filePath);
  }

  const ext = path.extname(filePath).toLowerCase();
  let accounts;

  if (ext === '.xlsx' || ext === '.xls') {
    accounts = loadFromXlsx(filePath);
  } else if (ext === '.csv') {
    accounts = loadFromCsv(filePath);
  } else {
    accounts = loadFromTxt(filePath);
  }

  return accounts;
}

module.exports = { loadHotmailAccounts };
