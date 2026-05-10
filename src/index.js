/**
 * ChatGPT Auto Signup Tool
 * Modified By: TMQ cui bap
 * 
 * Main entry point ─ simplified menu:
 *   1. Sequential signup (1 thread)
 *   2. Multi-thread signup (user inputs thread count)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Worker } = require('worker_threads');
const logger = require('./utils/logger');
const { loadHotmailAccounts } = require('./utils/hotmailPool');
const { loadProxies, assignProxy, checkAllProxies } = require('./utils/proxyPool');
const FileWriter = require('./utils/fileWriter');
const initCycleTLS = require('cycletls');
const { v4: uuidv4 } = require('uuid');
const { waitForOtp, getMessages, snapshotExistingUids } = require('./utils/hotmailReader');
const { generateRandomName, generateRandomBirthday } = require('./utils/emailGenerator');
const { generateSentinelTokens } = require('./utils/sentinelToken');
const { enable2FAAPI } = require('./utils/twoFactorSetup');
const ChatGPTAutopay = require('./autopay');
const { scanGopayDevices, printDevicesTable } = require('./utils/mumuDeviceScanner');
const { getTrialLink } = require('./utils/stripeLink');

const password = process.env.PASSWORD || 'ZxcvZxcv@123.';
const retries = parseInt(process.env.RETRIES) || 3;
const hotmailFile = process.env.HOTMAIL_ACCOUNTS_FILE || 'hotmail_accounts.xlsx';
const proxyFile = process.env.PROXY_LIST_FILE || 'proxy_list.txt';

const fileWriter = new FileWriter(path.join(__dirname, '..'));

// ── Cleanup: kill orphan CycleTLS Go processes on startup ──
const { execSync } = require('child_process');
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM "index-*.exe" 2>nul', { stdio: 'ignore' });
  }
} catch {}

// ── Graceful shutdown: cleanup CycleTLS on SIGINT/exit ──
let _activeCycleTLS = null;
function registerCycleTLS(instance) { _activeCycleTLS = instance; }
function cleanupCycleTLS() {
  if (_activeCycleTLS) {
    try { _activeCycleTLS.exit(); } catch {}
    _activeCycleTLS = null;
  }
}

// Track all active worker threads for cleanup
const _activeWorkerSet = new Set();

function killAllWorkers() {
  for (const w of _activeWorkerSet) {
    try { w.terminate(); } catch {}
  }
  _activeWorkerSet.clear();
  // Kill orphan CycleTLS Go processes
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /F /IM "index-*.exe" 2>nul', { stdio: 'ignore' });
  } catch {}
}

process.on('SIGINT', () => {
  console.log('\n\x1b[93m⚡️ Ctrl+C → dọn dẹp workers + CycleTLS...\x1b[0m');
  cleanupCycleTLS();
  killAllWorkers();
  process.exit(0);
});
process.on('exit', () => {
  cleanupCycleTLS();
  killAllWorkers();
});
process.on('uncaughtException', (e) => {
  logger.error('Uncaught: ' + e.message);
  cleanupCycleTLS();
  killAllWorkers();
  process.exit(1);
});

// COLOR_RULE.md — Chuẩn hóa màu
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[96m',       // Cyan (Light Blue) — INFO
  yellow: '\x1b[93m',     // Light Yellow — WARN
  green: '\x1b[92m',      // Light Green — SUCCESS
  gray: '\x1b[90m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  red: '\x1b[91m',        // Light Red — ERROR
  strike: '\x1b[9m',
  strikeOff: '\x1b[29m',
};

function getUserInput(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}




function printConfig(accounts, proxies, mode, threadCount) {
  console.log('  Mode        ' + C.green + mode + C.reset);
  console.log('  Proxies     ' + (proxies.length > 0 ? C.green + proxies.length : C.yellow + 'Direct (no proxy)') + C.reset);
  console.log('  Threads     ' + C.yellow + threadCount + C.reset);
  console.log('  Password    ' + C.gray + password.substring(0, 3) + '***' + C.reset);
  console.log('  Retries     ' + C.yellow + retries + C.reset);
  console.log(C.cyan + '───────────────────────────────────────' + C.reset);
}

// ── Sequential Signup ──────────────────────────────────────────────────

async function runSequential(accounts, proxies) {
  printConfig(accounts, proxies, 'Sequential (1 thread)', 1);
  console.log('');

  let cycleTLS = null;
  try {
    logger.info('Initializing CycleTLS...');
    cycleTLS = await initCycleTLS();
    registerCycleTLS(cycleTLS);
    logger.success('CycleTLS ready');

    let successCount = 0;
    const registeredEmails = fileWriter.getRegisteredEmails();

    // Remove already-registered emails from hotmail file + skip them
    if (registeredEmails.size > 0) {
      const before = accounts.length;
      for (const doneEmail of registeredEmails) {
        fileWriter.removeFromHotmailXlsx(doneEmail, hotmailFile);
      }
      accounts = accounts.filter(a => !registeredEmails.has(a.email.toLowerCase().trim()));
      const removed = before - accounts.length;
      if (removed > 0) {
        logger.warn('⚠️ Đã xóa ' + removed + ' email đã đăng ký khỏi danh sách (' + accounts.length + ' còn lại)');
      }
    }

    const total = accounts.length;

    for (let i = 0; i < total; i++) {
      const account = accounts[i];
      const proxyUrl = assignProxy(proxies, i);
      const log = logger.withContext(i + 1, account.email);



      if (i > 0) {
        const wait = Math.floor(Math.random() * 5) + 2;
        log.info('Waiting ' + wait + 's...');
        await new Promise(r => setTimeout(r, wait * 1000));
      }

      try {
        const result = await runSingleSignup(account, proxyUrl, i + 1, cycleTLS);
        if (result.success) {
          const sessionData = result.sessionData || null;
          const accessToken = result.accessToken || result.sessionData?.accessToken || '';

          // Enable 2FA via API
          let twoFaSecret = '';
          if (accessToken) {
            try {
              const secret = await enable2FAAPI(accessToken, proxyUrl);
              if (secret) {
                twoFaSecret = secret;
                log.success('[6/7] 2FA: ' + secret);
              } else {
                log.warn('[6/7] 2FA: không lấy được secret');
              }
            } catch (e) {
              log.warn('[6/7] 2FA lỗi: ' + e.message);
            }
          }

          fileWriter.writeResultToXlsx({
            email: result.email,
            chatgptPassword: password,
            twoFa: twoFaSecret,
            sessionData: sessionData,
            hotmailInfo: account,
            status: 'SUCCESS',
          });
          fileWriter.removeFromHotmailXlsx(account.email, hotmailFile);
          registeredEmails.add(account.email.toLowerCase().trim());
          log.success('[7/7] Hoàn tất');
          successCount++;
        } else {
          log.error(result.error);
        }
      } catch (e) {
        log.error('Fatal: ' + e.message);
      }
    }

    console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
    console.log(C.bold + C.white + ' SIGNUP DONE' + C.reset + ' ' + C.green + successCount + C.reset + '/' + C.yellow + total + C.reset + ' accounts created');
    console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);
  } finally {
    if (cycleTLS) {
      try { await cycleTLS.exit(); } catch {}
    }
  }
}

async function runSingleSignup(hotmailAccount, proxyUrl, threadId, cycleTLS) {
  const { runSignupViaAPI } = require('./utils/apiSignup');
  const deviceId = uuidv4();
  const sessionId = uuidv4();
  const sentinelId = uuidv4();
  const name = generateRandomName();
  const birthdate = generateRandomBirthday().full;
  const log = logger.withContext(threadId, hotmailAccount.email);

  // Snapshot existing emails ─ exclude both UIDs and OTP codes
  const existingMessages = await getMessages(
    hotmailAccount.email,
    hotmailAccount.refreshToken,
    hotmailAccount.clientId
  );
  const seenUids = snapshotExistingUids(existingMessages);
  // Pre-fill used codes from existing messages so stale OTPs are never returned
  seenUids._usedCodes = new Set();
  for (const msg of existingMessages) {
    const code = (msg.code || '').trim();
    if (code && /^\d{6}$/.test(code)) seenUids._usedCodes.add(code);
    const html = msg.message || '';
    if (html) {
      const extracted = require('./utils/hotmailReader').extractOtpFromHtml(html);
      if (extracted) seenUids._usedCodes.add(extracted);
    }
  }

  const maxAttempts = retries;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      log.warn('Retry ' + attempt + '/' + (maxAttempts - 1) + '...');
      await new Promise(r => setTimeout(r, 2000));
      // Re-snapshot to exclude all OTPs received so far
      const freshMsgs = await getMessages(hotmailAccount.email, hotmailAccount.refreshToken, hotmailAccount.clientId);
      for (const m of freshMsgs) { if (m.uid != null) seenUids.add(m.uid); }
    }



    let result;
    try {
      result = await runSignupViaAPI(proxyUrl, {
        email: hotmailAccount.email,
        password,
        name,
        birthdate,
        deviceId: attempt > 0 ? uuidv4() : deviceId,
        sessionId: attempt > 0 ? uuidv4() : sessionId,
        sharedCycleTLS: cycleTLS,
        sentinelFn: async (flow, cookies, tlsFn) => {
          try {
            return await generateSentinelTokens(proxyUrl, '', flow, sentinelId, tlsFn || cycleTLS);
          } catch (e) {
            return null;
          }
        },
        otpFn: async () => {
          return await waitForOtp(
            hotmailAccount.email,
            hotmailAccount.refreshToken,
            hotmailAccount.clientId,
            120,
            seenUids
          );
        },
        onStep: step => log.info(step),
      });
    } catch (e) {
      const msg = e.message?.includes('socket') || e.message?.includes('ECONN')
        ? 'Network/proxy error' : e.message;
      log.warn('Error: ' + msg);
      if (attempt < maxAttempts - 1) continue;
      return { success: false, email: hotmailAccount.email, error: msg };
    }

    if (result.success) {
      return { success: true, email: hotmailAccount.email, password, accessToken: result.accessToken, sessionData: result.sessionData };
    }

    if (result.step === 'otp') {
      return { success: false, email: hotmailAccount.email, error: 'OTP not received' };
    }

    if (result.step === 'create_account' && result.data?.error?.code === 'unsupported_country') {
      return { success: false, email: hotmailAccount.email, error: 'Country not supported. Change proxy.' };
    }

    // 409 = account already registered ─ don't retry
    if (result.step === 'create_account' && result.status === 409) {
      return { success: false, email: hotmailAccount.email, error: 'Email đã đăng ký rồi → skip' };
    }

    const errorMsg = result.error || result.step + ' failed';
    log.warn(errorMsg);

    // Don't retry permanent failures
    const noRetryKeywords = ['already', 'exist', 'registered', 'duplicate', 'banned', 'blocked'];
    const isPermFail = noRetryKeywords.some(kw => errorMsg.toLowerCase().includes(kw));
    if (isPermFail || attempt >= maxAttempts - 1) {
      return { success: false, email: hotmailAccount.email, error: errorMsg };
    }
  }

  return { success: false, email: hotmailAccount.email, error: 'All retries exhausted' };
}

// ── Multi-Thread Signup ────────────────────────────────────────────────

async function runMultiThread(accounts, proxies, threadCount) {
  printConfig(accounts, proxies, 'Multi-Thread', threadCount);
  console.log('');

  const total = accounts.length;
  let successCount = 0;
  let failCount = 0;
  let completedCount = 0;
  let taskIndex = 0;

  const workerPath = path.join(__dirname, 'worker.js');
  const activeWorkers = new Map();
  const freeSlots = []; // available thread slots
  for (let i = threadCount; i >= 1; i--) freeSlots.push(i);

  // COLOR_RULE.md colors
  const LEVEL_COLORS = {
    info:    '\x1b[96m',
    success: '\x1b[92m',
    warn:    '\x1b[93m',
    error:   '\x1b[91m',
  };
  const R = '\x1b[0m';

  return new Promise(resolve => {
    function mts() {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' +
             String(d.getMinutes()).padStart(2, '0') + ':' +
             String(d.getSeconds()).padStart(2, '0');
    }

    // Formatted log for multi-thread main process
    function mlog(slot, email, step, msg, level) {
      const color = LEVEL_COLORS[level] || LEVEL_COLORS.info;
      console.log(color + '[' + mts() + '] - [#T' + slot + '] - [' + email + '] - [' + step + '] - ' + msg + R);
    }

    function spawnWorker() {
      if (taskIndex >= total || freeSlots.length === 0) return;

      const slot = freeSlots.pop(); // Take a free slot
      const idx = taskIndex++;
      const account = accounts[idx];
      const proxyUrl = assignProxy(proxies, idx);

      mlog(slot, account.email, '-', '📧 Bắt đầu', 'info');

      const worker = new Worker(workerPath, {
        workerData: {
          hotmailAccount: account,
          proxyUrl,
          threadId: slot,
          chatgptPassword: password,
          retries,
        },
      });

      activeWorkers.set(slot, worker);
      _activeWorkerSet.add(worker);

      worker.on('message', msg => {
        if (msg.type === 'result') {
          if (msg.success) {
            fileWriter.writeResultToXlsx({
              email: msg.email,
              chatgptPassword: password,
              twoFa: msg.twoFaSecret || '',
              sessionData: msg.sessionData || null,
              hotmailInfo: msg.hotmailInfo || null,
              status: 'SUCCESS',
            });
            fileWriter.removeFromHotmailXlsx(msg.email, hotmailFile);
            mlog(slot, msg.email, '-', '✅ Saved to xlsx', 'success');
            successCount++;
          } else {
            // Remove already-registered emails from source
            if (msg.error && msg.error.includes('already registered')) {
              fileWriter.removeFromHotmailXlsx(msg.email, hotmailFile);
            }
            // Worker đã log ❌ rồi ─ không log lại 💥 đây
            failCount++;
          }
        }

        if (msg.type === 'done') {
          completedCount++;
          activeWorkers.delete(slot);
          _activeWorkerSet.delete(worker);
          freeSlots.push(slot);
          printProgress(successCount, failCount, completedCount, total);

          spawnWorker();

          if (completedCount >= total) {
            printSummary(successCount, failCount, total);
            resolve();
          }
        }
      });

      worker.on('error', err => {
        mlog(slot, account.email, '-', '💥 ' + err.message, 'error');
        failCount++;
        completedCount++;
        activeWorkers.delete(slot);
        _activeWorkerSet.delete(worker);
        freeSlots.push(slot);
        printProgress(successCount, failCount, completedCount, total);

        spawnWorker();

        if (completedCount >= total) {
          printSummary(successCount, failCount, total);
          resolve();
        }
      });

      worker.on('exit', code => {
        if (code !== 0 && activeWorkers.has(slot)) {
          activeWorkers.delete(slot);
          if (!freeSlots.includes(slot)) freeSlots.push(slot);
        }
      });
    }

    // Stagger threads 3s apart
    const initialBatch = Math.min(threadCount, total);
    for (let i = 0; i < initialBatch; i++) {
      setTimeout(() => spawnWorker(), i * 3000);
    }
  });
}

function printProgress(success, fail, completed, total) {
  const remaining = total - completed;
  console.log(
    C.gray + '  Progress: ' + C.reset +
    C.green + success + ' ✅' + C.reset + ' | ' +
    C.red + fail + ' ❌' + C.reset + ' | ' +
    C.yellow + remaining + ' remaining' + C.reset +
    ' (' + completed + '/' + total + ')'
  );
}

function printSummary(success, fail, total) {
  console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
  console.log(C.bold + C.white + ' SIGNUP DONE' + C.reset);
  console.log(C.cyan + '───────────────────────────────────────────' + C.reset);
  console.log('  ' + C.green + '✅ Success    : ' + success + C.reset);
  console.log('  ' + C.red + '❌ Failed     : ' + fail + C.reset);
  console.log('  ' + C.yellow + '  Total      : ' + total + C.reset);
  console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);
}

// ── Autopay Mode ───────────────────────────────────────────────────────

async function runAutopayMode(proxies, gopayDevices) {
  let payAccounts = fileWriter.getAccountsForAutopay();
  if (payAccounts.length === 0) {
    logger.error('Không có account nào có accessToken trong Account_ChatGPT_Data.xlsx');
    return;
  }

  // Skip accounts already marked Plus (have Note column filled)
  const plusEmails = fileWriter.getPlusEmails();
  if (plusEmails.size > 0) {
    const before = payAccounts.length;
    payAccounts = payAccounts.filter(a => !plusEmails.has(a.email.toLowerCase().trim()));
    const skipped = before - payAccounts.length;
    if (skipped > 0) logger.warn('Skipped ' + skipped + ' accounts (already Plus)');
    if (payAccounts.length === 0) {
      logger.info('Tất cả accounts đã lên Plus rồi!');
      return;
    }
  }
  logger.info('Tìm thấy ' + payAccounts.length + ' account cần autopay');

  if (!gopayDevices || gopayDevices.length === 0) {
    logger.error('Không có GoPay device nào. Rename MuMu instance thành PHONE_PIN.');
    return;
  }

  const gopayCountryCode = '62';



  let successCount = 0;
  const results = [];

  for (let i = 0; i < payAccounts.length; i++) {
    const acc = payAccounts[i];
    const log = logger.withContext(i + 1, acc.email);

    const device = gopayDevices[i % gopayDevices.length];
    const gopayPhone = device.phone;
    const gopayPin = device.pin;
    const proxyUrl = proxies.length > 0 ? proxies[i % proxies.length] : null;



    const autopay = new ChatGPTAutopay({
      email: acc.email,
      password: acc.password,
      name: acc.email.split('@')[0],
      accessToken: acc.accessToken,
      skipLogin: true,
      skipOtp: true,
      proxyUrl: proxyUrl || null,
      checkoutProxyUrl: proxyUrl || null,
      gopayCountryCode,
      gopayPhone,
      gopayPin,
      threadId: i + 1,
      adbPath: process.env.MUMU_ADB_PATH || null,
      deviceSerial: device.adbSerial || null,
    });

    try {
      const result = await autopay.runAutopay();
      if (result.success) {
        log.success('ChatGPT Plus activated!');
        await fileWriter.markAccountAsPlusInXlsx(acc.email);
        successCount++;
        results.push({ email: acc.email, status: 'SUCCESS', plan: 'Plus' });
      } else {
        if (!result.noRetry) {
          log.error(result.error || 'Unknown error');
        }
        results.push({ email: acc.email, status: 'FAILED', error: result.error });
      }
    } catch (e) {
      log.error(e.message);
      results.push({ email: acc.email, status: 'ERROR', error: e.message });
    }

    if (i < payAccounts.length - 1) {
      const wait = Math.floor(Math.random() * 3) + 3;
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }

  console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
  console.log(C.bold + C.white + ' AUTOPAY DONE' + C.reset + ' ' + C.green + successCount + C.reset + '/' + C.yellow + payAccounts.length + C.reset + ' accounts upgraded');
  console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);

  // Save results
  try {
    const fs = require('fs');
    const lines = results.map(r => r.email + '|' + r.status + '|' + (r.error || r.plan || ''));
    fs.writeFileSync(path.join(__dirname, '..', 'autopay_results.txt'), lines.join('\n'), 'utf8');
    logger.info('Results saved → autopay_results.txt');
  } catch {}
}

// ── Signup + Autopay Combined ──────────────────────────────────────────

async function runSignupAndAutopay(accounts, proxies, gopayDevices) {
  if (!gopayDevices || gopayDevices.length === 0) {
    logger.error('Không có GoPay device nào. Rename MuMu instance thành PHONE_PIN.');
    return;
  }

  const gopayCountryCode = '62';

  printConfig(accounts, proxies, 'Signup + Autopay (1 thread)', 1);
  console.log('  Devices     ' + C.green + gopayDevices.length + C.reset + ' (round-robin)');
  console.log(C.cyan + '───────────────────────────────────────' + C.reset);
  console.log('');

  let cycleTLS = null;
  try {
    logger.info('Initializing CycleTLS...');
    cycleTLS = await initCycleTLS();
    registerCycleTLS(cycleTLS);
    logger.success('CycleTLS ready');

    let signupSuccess = 0;
    let signupFail = 0;
    let autopaySuccess = 0;
    let autopayFail = 0;
    const registeredEmails = fileWriter.getRegisteredEmails();

    // Remove already-registered emails
    if (registeredEmails.size > 0) {
      const before = accounts.length;
      for (const doneEmail of registeredEmails) {
        fileWriter.removeFromHotmailXlsx(doneEmail, hotmailFile);
      }
      accounts = accounts.filter(a => !registeredEmails.has(a.email.toLowerCase().trim()));
      const removed = before - accounts.length;
      if (removed > 0) {
        logger.warn('⚠️ Đã xóa ' + removed + ' email đã đăng ký khỏi danh sách (' + accounts.length + ' còn lại)');
      }
    }

    const total = accounts.length;

    for (let i = 0; i < total; i++) {
      const account = accounts[i];
      const proxyUrl = proxies.length > 0 ? proxies[i % proxies.length] : null;
      const log = logger.withContext(i + 1, account.email);



      if (i > 0) {
        const wait = Math.floor(Math.random() * 5) + 2;
        log.info('Waiting ' + wait + 's...');
        await new Promise(r => setTimeout(r, wait * 1000));
      }

      // ── PHASE 1: Signup ──
      try {
        const result = await runSingleSignup(account, proxyUrl, i + 1, cycleTLS);
        if (result.success) {
          const sessionData = result.sessionData || null;
          const accessToken = result.accessToken || result.sessionData?.accessToken || '';

          // Enable 2FA via API
          let twoFaSecret = '';
          if (accessToken) {
            try {
              const secret = await enable2FAAPI(accessToken, proxyUrl);
              if (secret) {
                twoFaSecret = secret;
                log.success('[6/7] 2FA: ' + secret);
              } else {
                log.warn('[6/7] 2FA: không lấy được secret');
              }
            } catch (e) {
              log.warn('[6/7] 2FA lỗi: ' + e.message);
            }
          }

          fileWriter.writeResultToXlsx({
            email: result.email,
            chatgptPassword: password,
            twoFa: twoFaSecret,
            sessionData: sessionData,
            hotmailInfo: account,
            status: 'SUCCESS',
          });
          fileWriter.removeFromHotmailXlsx(account.email, hotmailFile);
          registeredEmails.add(account.email.toLowerCase().trim());
          log.success('[7/7] Signup hoàn tất');
          signupSuccess++;

          // ── PHASE 2: Autopay ngay sau signup ──
          if (accessToken) {
            const device = gopayDevices[i % gopayDevices.length];
            const gopayPhone = device.phone;
            const gopayPin = device.pin;

            log.info('Autopay → device: +' + gopayCountryCode + gopayPhone);
            try {
              const autopay = new ChatGPTAutopay({
                email: result.email,
                password: password,
                name: result.email.split('@')[0],
                accessToken: accessToken,
                skipLogin: true,
                skipOtp: true,
                proxyUrl: proxyUrl || null,
                checkoutProxyUrl: proxyUrl || null,
                gopayCountryCode,
                gopayPhone,
                gopayPin,
                threadId: i + 1,
                adbPath: process.env.MUMU_ADB_PATH || null,
                deviceSerial: device.adbSerial || null,
              });

              const payResult = await autopay.runAutopay();
              if (payResult.success) {
                log.success('ChatGPT Plus activated!');
                await fileWriter.markAccountAsPlusInXlsx(result.email);
                autopaySuccess++;
              } else {
                log.error(payResult.error || 'Unknown error');
                if (payResult.hint) log.warn(payResult.hint);
                autopayFail++;
              }
            } catch (e) {
              log.error(e.message);
              autopayFail++;
            }
          } else {
            log.warn('Bỏ qua autopay (không có accessToken)');
            autopayFail++;
          }

        } else {
          log.error(result.error);
          signupFail++;
        }
      } catch (e) {
        logger.error('[#' + (i + 1) + '] Fatal: ' + e.message);
        signupFail++;
      }
    }

    console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
    console.log(C.bold + C.white + ' SIGNUP + AUTOPAY DONE' + C.reset);
    console.log(C.cyan + '───────────────────────────────────────────' + C.reset);
    console.log('  Signup   ' + C.green + signupSuccess + ' ✅' + C.reset + ' | ' + C.red + signupFail + ' ❌' + C.reset + ' / ' + C.yellow + total + C.reset);
    console.log('  Autopay  ' + C.green + autopaySuccess + ' ✅' + C.reset + ' | ' + C.red + autopayFail + ' ❌' + C.reset + ' / ' + C.yellow + signupSuccess + C.reset);
    console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);
  } finally {
    if (cycleTLS) {
      try { await cycleTLS.exit(); } catch {}
    }
  }
}

// ── Get Stripe Payment Links ──────────────────────────────────────────

async function runGetStripeLinks(proxies) {
  const stripeCountry = process.env.STRIPE_COUNTRY_CODE || 'ID';
  const THREAD_COUNT = 3;
  const STAGGER_MS = 2000;

  const accounts = fileWriter.getAccountsForStripeLink();
  if (accounts.length === 0) {
    logger.error('Không có account nào eligible đỒ get link (cần có session, chưa Plus, chưa có link)');
    return;
  }

  console.log('  Mode        ' + C.green + 'Get Stripe Payment Links' + C.reset);
  console.log('  Threads     ' + C.yellow + THREAD_COUNT + C.reset);
  console.log('  Country     ' + C.green + stripeCountry + C.reset);
  console.log('  Proxies     ' + (proxies.length > 0 ? C.green + proxies.length : C.yellow + 'Direct') + C.reset);
  console.log(C.cyan + '───────────────────────────────────────' + C.reset);
  console.log('');

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let taskIndex = 0;

  // Split work across threads ─ each thread pulls from shared queue
  const processAccount = async (threadId) => {
    while (taskIndex < accounts.length) {
      const idx = taskIndex++;
      const acc = accounts[idx];
      const proxyUrl = proxies.length > 0 ? proxies[idx % proxies.length] : null;
      const tag = '[T' + threadId + '] [' + (idx + 1) + '/' + accounts.length + '] ';

      logger.info(tag + '📧 ' + acc.email + (proxyUrl ? ' → proxy ' + proxyUrl.replace(/:[^:@]+@/, ':***@') : ''));

      try {
        const result = await getTrialLink(acc.accessToken, proxyUrl, stripeCountry);

        if (result.success) {
          await fileWriter.writePaymentLinkToXlsx(acc.email, result.url);
          logger.success(tag + '✅ ' + acc.email + ' → ' + result.url.substring(0, 60) + '...');
          successCount++;
        } else if (result.state && result.state !== 'eligible') {
          logger.warn(tag + '⏭️  ' + acc.email + ' → coupon ' + result.state);
          skipCount++;
        } else {
          logger.error(tag + '❌ ' + acc.email + ' → ' + (result.error || 'Unknown'));
          failCount++;
        }
      } catch (e) {
        logger.error(tag + '💥 ' + acc.email + ' → ' + e.message);
        failCount++;
      }

      // Small delay between requests in same thread
      if (taskIndex < accounts.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  };

  // Launch threads with stagger
  const threads = [];
  for (let t = 0; t < Math.min(THREAD_COUNT, accounts.length); t++) {
    threads.push(
      new Promise(resolve => {
        setTimeout(async () => {
          await processAccount(t + 1);
          resolve();
        }, t * STAGGER_MS);
      })
    );
  }

  await Promise.all(threads);

  console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
  console.log(C.bold + C.white + ' STRIPE LINKS DONE' + C.reset);
  console.log(C.cyan + '───────────────────────────────────────────' + C.reset);
  console.log('  ' + C.green + '✅ Success    : ' + successCount + C.reset);
  console.log('  ' + C.yellow + '⏭ Skipped    : ' + skipCount + C.reset);
  console.log('  ' + C.red + '❌ Failed     : ' + failCount + C.reset);
  console.log('  ' + C.white + '  Total      : ' + accounts.length + C.reset);
  console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const R = C.reset;
  const B = C.cyan + C.bold;
  const W = 68;
  const line = '═'.repeat(W);
  const dash = '─'.repeat(W);

  // ── Spinner utility ──
  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  function startSpinner(text) {
    let i = 0;
    const id = setInterval(() => {
      process.stdout.write('\r' + C.yellow + '  ' + FRAMES[i++ % FRAMES.length] + ' ' + text + R + '\x1b[K');
    }, 80);
    return {
      done: (msg) => {
        clearInterval(id);
        process.stdout.write('\r\x1b[K');
        if (msg) console.log(C.green + '  ✅ ' + msg + R);
      },
      fail: (msg) => {
        clearInterval(id);
        process.stdout.write('\r\x1b[K');
        if (msg) console.log(C.red + '  ❌ ' + msg + R);
      },
    };
  }

  // ── Visual-width-aware padding ──
  const emojiWidth = (s) => {
    const emojiCount = (s.match(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u26A1\u274C\u2139\uFE0F]/gu) || []).length;
    return s.length + emojiCount;
  };
  const padV = (s, w) => s + ' '.repeat(Math.max(0, w - emojiWidth(s)));
  const centerText = (text, w) => {
    const pad = Math.max(0, w - text.length);
    return ' '.repeat(Math.floor(pad / 2)) + text + ' '.repeat(Math.ceil(pad / 2));
  };

  console.log('');

  // ══════════════════════ PHASE 1: LOADING ══════════════════════

  // 1. Load Hotmail accounts
  const sp1 = startSpinner('Loading Hotmail accounts...');
  const hotmailPath = path.join(__dirname, '..', hotmailFile);
  let accounts;
  try {
    accounts = loadHotmailAccounts(hotmailPath);
  } catch (e) {
    sp1.fail(e.message);
    logger.error('Create ' + hotmailFile + ' with columns: Email, Pass, Refresh Token, Client ID');
    process.exit(1);
  }
  if (accounts.length === 0) {
    sp1.fail('No Hotmail accounts found');
    process.exit(1);
  }
  sp1.done(accounts.length + ' Hotmail accounts loaded');

  // 2. Load & check proxies
  const proxyPath = path.join(__dirname, '..', proxyFile);
  const rawProxies = loadProxies(proxyPath);
  let proxies = [];
  if (rawProxies.length > 0) {
    const sp2 = startSpinner('Checking ' + rawProxies.length + ' proxy(ies)...');
    proxies = await checkAllProxies(rawProxies);
    sp2.done(proxies.length + '/' + rawProxies.length + ' proxy live');
    console.log('');
  } else {
    console.log(C.yellow + '  ⚡ No proxy → Direct mode' + R);
  }

  // 3. Scan MuMu GoPay devices
  const mumuManagerPath = process.env.MUMU_MANAGER_PATH || '';
  let gopayDevices = [];
  if (mumuManagerPath) {
    const sp3 = startSpinner('Scanning GoPay devices...');
    gopayDevices = await scanGopayDevices(mumuManagerPath);
    if (gopayDevices.length > 0) {
      sp3.done(gopayDevices.length + ' GoPay device(s) found');
      printDevicesTable(gopayDevices);
    } else {
      sp3.done('No GoPay devices');
    }
  }

  const hasGopay = gopayDevices.length > 0;

  // Clear screen after loading ─ fresh start for final UI
  console.clear();

  // ══════════════════════ MENU (top of screen) ══════════════════════
  const gS = hasGopay ? '' : (C.gray + C.strike);
  const gE = hasGopay ? '' : (C.strikeOff + R);

  console.log('');
  console.log(B + '  ╔' + line + '╗' + R);
  console.log(B + '  ║' + centerText('⚡  CHATGPT AUTO TOOL  ⚡', W) + '║' + R);
  console.log(B + '  ║' + centerText('Modified By: TMQ cui bap', W) + '║' + R);
  console.log(B + '  ╠' + line + '╣' + R);
  console.log(B + '  ║' + R + padV('   [1]  🚀  Đăng ký tuần tự (1 luồng)', W) + B + '║' + R);
  console.log(B + '  ║' + R + padV('   [2]  ⚡  Đăng ký đa luồng', W) + B + '║' + R);
  console.log(B + '  ╟' + dash + '╢' + R);
  console.log(B + '  ║' + gS + padV('   [3]  💳  Thanh toán GoPay (Autopay)', W) + gE + B + '║' + R);
  console.log(B + '  ║' + gS + padV('   [4]  🔥  Signup + Autopay tự động', W) + gE + B + '║' + R);
  console.log(B + '  ╟' + dash + '╢' + R);
  console.log(B + '  ║' + R + padV('   [5]  💳  Get link Stripe Payment', W) + B + '║' + R);
  console.log(B + '  ╟' + dash + '╢' + R);
  console.log(B + '  ║' + R + padV('   [0]  ❌  Exit', W) + B + '║' + R);
  console.log(B + '  ╚' + line + '╝' + R);

  if (!hasGopay) {
    console.log('\x1b[91m' + C.bold + '  ⚠️  GoPay không khả dụng → Option 3, 4 bị vô hiệu hóa' + R);
  }

  // ══════════════════════ SYSTEM STATUS ══════════════════════
  console.log('');
  console.log(B + '  ╔' + line + '╗' + R);
  console.log(B + '  ║' + centerText('SYSTEM STATUS', W) + '║' + R);
  console.log(B + '  ╠' + line + '╣' + R);
  console.log(B + '  ║' + R + padV('   📧  Hotmail      ' + C.yellow + accounts.length + R + ' accounts', W) + B + '║' + R);
  console.log(B + '  ║' + R + padV('   🌐  Proxy        ' + (proxies.length > 0 ? C.green + proxies.length + ' live' : C.yellow + 'Direct (no proxy)') + R, W) + B + '║' + R);
  console.log(B + '  ║' + R + padV('   📱  GoPay        ' + (hasGopay ? C.green + gopayDevices.length + ' devices' : C.gray + 'Không khả dụng') + R, W) + B + '║' + R);
  console.log(B + '  ╚' + line + '╝' + R);
  console.log('');

  // ══════════════════════ CHOICE ══════════════════════
  const choice = await getUserInput(C.green + C.bold + '  👉 Choose (1/2/3/4/5/0): ' + R);

  if (choice === '1') {
    await runSequential(accounts, proxies);
  } else if (choice === '2') {
    const threadInput = await getUserInput('Số luồng (VD: 5, 10, 20): ');
    const threadCount = parseInt(threadInput);
    if (isNaN(threadCount) || threadCount <= 0) {
      logger.error('Số luồng không hợp lệ');
      process.exit(1);
    }
    if (threadCount > accounts.length) {
      logger.warn('Threads (' + threadCount + ') > accounts (' + accounts.length + '). Giảm xuống ' + accounts.length);
    }
    const actualThreads = Math.min(threadCount, accounts.length);
    await runMultiThread(accounts, proxies, actualThreads);
  } else if (choice === '3') {
    if (!hasGopay) {
      console.log(C.red + '  ❌ GoPay không khả dụng! Cần rename MuMu instances sang PHONE_PIN.' + R);
      return;
    }
    await runAutopayMode(proxies, gopayDevices);
  } else if (choice === '4') {
    if (!hasGopay) {
      console.log(C.red + '  ❌ GoPay không khả dụng! Cần rename MuMu instances sang PHONE_PIN.' + R);
      return;
    }
    await runSignupAndAutopay(accounts, proxies, gopayDevices);
  } else if (choice === '5') {
    await runGetStripeLinks(proxies);
  } else {
    logger.info('Exiting...');
    process.exit(0);
  }
}

main().catch(e => {
  logger.error('Fatal error: ' + e.message);
  console.error(e);
  process.exit(1);
});
