/**
 * Centralized File Writer
 * 
 * Main-thread-only file writer. Workers send results via postMessage,
 * main thread writes to file through this module. No race conditions.
 */

const fs = require('fs');
const path = require('path');

const RESULT_HEADERS = ['Note', 'Email', 'Password ChatGPT', '2FA Secret', 'Full Session', 'Hotmail Info', 'Status', 'Payment Link'];

class FileWriter {
  constructor(basePath) {
    this.basePath = basePath || path.join(__dirname, '..', '..');
    this._xlsxQueue = [];
    this._xlsxWriting = false;
  }

  _filePath(name) {
    return path.join(this.basePath, name);
  }

  appendAccount(email, password) {
    const line = email + ':' + password + '\n';
    fs.appendFileSync(this._filePath('accounts.txt'), line);
  }

  /**
   * Write to account.txt with format: email|password|2fa|fullSessionJSON
   * @param {string} email
   * @param {string} chatgptPassword - password ChatGPT (NOT mail password)
   * @param {string} twoFa - 2FA secret or empty
   * @param {object|string} sessionData - full /api/auth/session JSON response
   */
  appendAccountTxt(email, chatgptPassword, twoFa, sessionData) {
    let sessionStr = '';
    if (sessionData && typeof sessionData === 'object') {
      sessionStr = JSON.stringify(sessionData);
    } else if (typeof sessionData === 'string') {
      sessionStr = sessionData;
    }
    const line = email + '|' + chatgptPassword + '|' + (twoFa || '') + '|' + sessionStr + '\n';
    fs.appendFileSync(this._filePath('account.txt'), line);
  }

  appendAccountPlus(email, password) {
    const line = email + ':' + password + '\n';
    fs.appendFileSync(this._filePath('accounts_plus.txt'), line);
  }

  appendLine(fileName, line) {
    fs.appendFileSync(this._filePath(fileName), line + '\n');
  }

  readLines(fileName) {
    const filePath = this._filePath(fileName);
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
  }

  /**
   * Write a signup result row to Account_ChatGPT_Data.xlsx
   * Thread-safe: queues writes and processes sequentially
   * 
   * @param {Object} params
   * @param {string} params.email - ChatGPT email
   * @param {string} params.chatgptPassword - Password used for ChatGPT
   * @param {string} params.twoFa - 2FA secret
   * @param {string} params.sessionToken - Session token from /api/auth/session
   * @param {Object} params.hotmailInfo - { email, password, refreshToken, clientId }
   * @param {string} params.status - "SUCCESS" or error message
   */
  writeResultToXlsx({ email, chatgptPassword, twoFa, sessionData, hotmailInfo, status }) {
    this._xlsxQueue.push({ email, chatgptPassword, twoFa, sessionData, hotmailInfo, status });
    this._processXlsxQueue();
  }

  async _processXlsxQueue() {
    if (this._xlsxWriting || this._xlsxQueue.length === 0) return;
    this._xlsxWriting = true;

    try {
      const ExcelJS = require('exceljs');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      let existingRows = [];

      if (fs.existsSync(filePath)) {
        try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.readFile(filePath);
          const ws = wb.getWorksheet(1);
          if (ws) {
            const headers = [];
            ws.getRow(1).eachCell((cell, col) => { headers[col] = cell.value; });
            ws.eachRow((row, rowNum) => {
              if (rowNum === 1) return;
              const obj = { _fill: null, _yellowFill: false };
              headers.forEach((h, col) => {
                if (h) obj[h] = row.getCell(col).value || '';
              });
              const fill = row.getCell(1).fill;
              if (fill && fill.fgColor && fill.fgColor.argb) {
                obj._fill = fill.fgColor.argb;
                if (fill.fgColor.argb === 'FFFFFFCC') obj._yellowFill = true;
              }
              existingRows.push(obj);
            });
          }
        } catch {
          existingRows = [];
        }
      }

      while (this._xlsxQueue.length > 0) {
        const item = this._xlsxQueue.shift();
        const hi = item.hotmailInfo || {};
        const hotmailStr = [hi.email || '', hi.password || '', hi.refreshToken || '', hi.clientId || ''].join('|');

        existingRows.push({
          'Note': '',
          'Email': item.email || '',
          'Password ChatGPT': item.chatgptPassword || '',
          '2FA Secret': item.twoFa || '',
          'Full Session': item.sessionData && typeof item.sessionData === 'object'
            ? JSON.stringify(item.sessionData)
            : (item.sessionData || ''),
          'Hotmail Info': hotmailStr !== '|||' ? hotmailStr : '',
          'Status': item.status || '',
        });
      }

      // Write with ExcelJS (preserves styling)
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('ChatGPT Accounts');

      ws.columns = [
        { header: 'Note', key: 'Note', width: 12 },
        { header: 'Email', key: 'Email', width: 40 },
        { header: 'Password ChatGPT', key: 'Password ChatGPT', width: 25 },
        { header: '2FA Secret', key: '2FA Secret', width: 35 },
        { header: 'Full Session', key: 'Full Session', width: 50 },
        { header: 'Hotmail Info', key: 'Hotmail Info', width: 50 },
        { header: 'Status', key: 'Status', width: 15 },
        { header: 'Payment Link', key: 'Payment Link', width: 60 },
      ];

      // Header styling — teal background, white bold text
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E8B57' } };
      const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      ws.getRow(1).eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle' };
      });

      // Data rows
      const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90EE90' } };
      const yellowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } };
      for (const row of existingRows) {
        const isPlus = row._fill === 'FF90EE90' || (row['Note'] && String(row['Note']).match(/\d/));
        const isYellow = row._yellowFill || row._fill === 'FFFFFFCC';
        const dataRow = ws.addRow({
          'Note': row['Note'] || '',
          'Email': row['Email'] || '',
          'Password ChatGPT': row['Password ChatGPT'] || '',
          '2FA Secret': row['2FA Secret'] || '',
          'Full Session': row['Full Session'] || '',
          'Hotmail Info': row['Hotmail Info'] || '',
          'Status': row['Status'] || '',
          'Payment Link': row['Payment Link'] || '',
        });
        if (isPlus) {
          dataRow.eachCell(cell => { cell.fill = greenFill; });
        } else if (isYellow) {
          dataRow.eachCell(cell => { cell.fill = yellowFill; });
        }
      }

      await wb.xlsx.writeFile(filePath);
    } catch (e) {
      // Silenced — EBUSY is expected when xlsx is open in Excel
    } finally {
      this._xlsxWriting = false;
      if (this._xlsxQueue.length > 0) {
        this._processXlsxQueue();
      }
    }
  }

  /**
   * Remove a hotmail account row from hotmail_accounts.xlsx after successful signup
   * @param {string} email - The email to remove
   * @param {string} [fileName='hotmail_accounts.xlsx'] - XLSX filename
   */
  async removeFromHotmailXlsx(email, fileName) {
    const xlsxFile = fileName || 'hotmail_accounts.xlsx';
    try {
      const ExcelJS = require('exceljs');
      const filePath = this._filePath(xlsxFile);
      if (!fs.existsSync(filePath)) return;

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.getWorksheet(1);
      if (!ws) return;

      const emailLower = email.toLowerCase().trim();

      // Find email column
      let emailCol = -1;
      ws.getRow(1).eachCell((cell, col) => {
        const val = String(cell.value || '').toLowerCase();
        if (val.includes('email') || val.includes('mail')) emailCol = col;
      });
      if (emailCol === -1) return;

      // Find row to remove
      let rowToRemove = -1;
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const val = String(row.getCell(emailCol).value || '').toLowerCase().trim();
        if (val === emailLower) rowToRemove = rowNum;
      });

      if (rowToRemove === -1) return;
      ws.spliceRows(rowToRemove, 1);

      // Re-apply header styling (salmon background)
      const salmonFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCD5C5C' } };
      const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      ws.getRow(1).eachCell(cell => {
        cell.fill = salmonFill;
        cell.font = headerFont;
        cell.alignment = { vertical: 'middle' };
      });

      await wb.xlsx.writeFile(filePath);
    } catch (e) {
      console.error('[FileWriter] remove hotmail error:', e.message);
    }
  }

  /**
   * Get Set of emails already registered (from Account_ChatGPT_Data.xlsx)
   * Used to skip already-registered emails at startup
   */
  getRegisteredEmails() {
    const registered = new Set();
    try {
      const XLSX = require('xlsx');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      if (!fs.existsSync(filePath)) return registered;
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      for (const row of rows) {
        const email = (row['Email'] || '').toLowerCase().trim();
        if (email) registered.add(email);
      }
    } catch {}
    return registered;
  }

  /**
   * Get accounts with accessToken for autopay (from Account_ChatGPT_Data.xlsx)
   */
  getPlusEmails() {
    const emails = new Set();
    try {
      const XLSX = require('xlsx');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      if (!require('fs').existsSync(filePath)) return emails;
      const wb = XLSX.readFile(filePath);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      for (const row of rows) {
        const email = (row['Email'] || '').trim().toLowerCase();
        const note = (row['Note'] || '').trim();
        if (email && note) emails.add(email);
      }
    } catch {}
    return emails;
  }

  getAccountsForAutopay() {
    const accounts = [];
    try {
      const XLSX = require('xlsx');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      if (!fs.existsSync(filePath)) return accounts;
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      for (const row of rows) {
        const email = (row['Email'] || '').trim();
        const pw = (row['Password ChatGPT'] || '').trim();
        const twoFa = (row['2FA Secret'] || '').trim();
        let accessToken = '';
        try {
          const sess = JSON.parse(row['Full Session'] || '{}');
          accessToken = sess.accessToken || '';
        } catch {}
        if (email && accessToken) {
          accounts.push({ email, password: pw, twoFa, accessToken });
        }
      }
    } catch {}
    return accounts;
  }

  /**
   * Mark an account as Plus in Account_ChatGPT_Data.xlsx
   * Sets Note = current date, highlights entire row green
   */
  async markAccountAsPlusInXlsx(email) {
    try {
      const ExcelJS = require('exceljs');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      if (!fs.existsSync(filePath)) return;

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.getWorksheet(1);
      if (!ws) return;

      const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90EE90' } };
      const emailLower = email.toLowerCase().trim();
      const today = new Date();
      const dateStr = (today.getMonth() + 1) + '/' + today.getDate() + '/' + today.getFullYear();

      // Find email column index
      let emailCol = -1;
      let noteCol = -1;
      ws.getRow(1).eachCell((cell, col) => {
        const val = String(cell.value || '').trim();
        if (val === 'Email') emailCol = col;
        if (val === 'Note') noteCol = col;
      });
      if (emailCol === -1) return;

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const cellVal = String(row.getCell(emailCol).value || '').toLowerCase().trim();
        if (cellVal === emailLower) {
          // Set Note = date
          if (noteCol > 0) row.getCell(noteCol).value = dateStr;
          // Green fill entire row
          row.eachCell(cell => { cell.fill = greenFill; });
        }
      });

      await wb.xlsx.writeFile(filePath);
    } catch (e) {
      console.error('[FileWriter] markPlus error:', e.message);
    }
  }

  /**
   * Get accounts eligible for Stripe link generation
   * Skip: already Plus (green fill / Note has date), already has Payment Link, no session
   */
  getAccountsForStripeLink() {
    const accounts = [];
    try {
      const ExcelJS = require('exceljs');
      const XLSX = require('xlsx');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      if (!fs.existsSync(filePath)) return accounts;
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const email = (row['Email'] || '').trim();
        const note = String(row['Note'] || '').trim();
        const status = String(row['Status'] || '').trim();
        const paymentLink = String(row['Payment Link'] || '').trim();
        let accessToken = '';
        try {
          const sess = JSON.parse(row['Full Session'] || '{}');
          accessToken = sess.accessToken || '';
        } catch {}

        // Skip: no email or no session
        if (!email || !accessToken) continue;
        // Skip: already Plus (Note has date-like content)
        if (note && /\d/.test(note)) continue;
        // Skip: already has payment link
        if (paymentLink && paymentLink.startsWith('http')) continue;

        accounts.push({ email, accessToken, rowIndex: i + 2 }); // +2: 1-indexed + header
      }
    } catch (e) {
      console.error('[FileWriter] getAccountsForStripeLink error:', e.message);
    }
    return accounts;
  }

  /**
   * Write payment link to column H and highlight row yellow
   */
  async writePaymentLinkToXlsx(email, paymentLink) {
    try {
      const ExcelJS = require('exceljs');
      const filePath = this._filePath('Account_ChatGPT_Data.xlsx');
      if (!fs.existsSync(filePath)) return;

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const ws = wb.getWorksheet(1);
      if (!ws) return;

      const yellowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } };
      const emailLower = email.toLowerCase().trim();

      // Find email & payment link column indices
      let emailCol = -1;
      let linkCol = -1;
      ws.getRow(1).eachCell((cell, col) => {
        const val = String(cell.value || '').trim();
        if (val === 'Email') emailCol = col;
        if (val === 'Payment Link') linkCol = col;
      });

      // If Payment Link column doesn't exist, create it
      if (linkCol === -1) {
        const lastCol = ws.columnCount + 1;
        linkCol = lastCol;
        const headerCell = ws.getRow(1).getCell(linkCol);
        headerCell.value = 'Payment Link';
        headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E8B57' } };
        headerCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerCell.alignment = { vertical: 'middle' };
        ws.getColumn(linkCol).width = 60;
      }

      if (emailCol === -1) return;

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const cellVal = String(row.getCell(emailCol).value || '').toLowerCase().trim();
        if (cellVal === emailLower) {
          // Set payment link
          row.getCell(linkCol).value = paymentLink;
          // Yellow fill for entire row (only if not already green/Plus)
          const existingFill = row.getCell(1).fill;
          const isGreen = existingFill && existingFill.fgColor && existingFill.fgColor.argb === 'FF90EE90';
          if (!isGreen) {
            row.eachCell({ includeEmpty: true }, cell => { cell.fill = yellowFill; });
          }
        }
      });

      await wb.xlsx.writeFile(filePath);
    } catch (e) {
      console.error('[FileWriter] writePaymentLink error:', e.message);
    }
  }
}

module.exports = FileWriter;
