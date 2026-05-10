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

// ── Device Pool (Semaphore for MuMu devices) ──────────────────────────

class DevicePool {
  constructor(devices) {
    this._devices = devices.map(d => ({ ...d, _busy: false }));
    this._waiters = [];
  }

  acquire(timeoutMs = 300000) {
    const free = this._devices.find(d => !d._busy);
    if (free) {
      free._busy = true;
      return Promise.resolve(free);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new Error('Device acquire timeout (' + (timeoutMs / 1000) + 's)'));
      }, timeoutMs);
      this._waiters.push({ resolve, timer });
    });
  }

  release(device) {
    device._busy = false;
    if (this._waiters.length > 0) {
      device._busy = true;
      const { resolve, timer } = this._waiters.shift();
      clearTimeout(timer);
      resolve(device);
    }
  }

  status() {
    const busy = this._devices.filter(d => d._busy).length;
    return { busy, free: this._devices.length - busy, total: this._devices.length };
  }
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

// ── Multi-Thread Signup (Async Concurrency — 1 CycleTLS) ───────────────

async function runMultiThread(accounts, proxies, threadCount) {
  printConfig(accounts, proxies, 'Multi-Thread', threadCount);
  console.log('');

  const initCycleTLS = require('cycletls');
  const { v4: uuidv4 } = require('uuid');
  const { waitForOtp, snapshotExistingUids, getMessages } = require('./utils/hotmailReader');
  const { generateRandomName, generateRandomBirthday } = require('./utils/emailGenerator');
  const { generateSentinelTokens } = require('./utils/sentinelToken');
  const { enable2FAAPI } = require('./utils/twoFactorSetup');
  const { runSignupViaAPI } = require('./utils/apiSignup');

  const total = accounts.length;
  let successCount = 0;
  let failCount = 0;
  let completedCount = 0;

  // CycleTLS Pool — 1 instance per 3 threads, min 2, max 5
  const poolSize = Math.max(2, Math.min(5, Math.ceil(threadCount / 3)));
  logger.info('Initializing CycleTLS pool (' + poolSize + ' instances)...');
  const tlsPool = [];
  for (let i = 0; i < poolSize; i++) {
    tlsPool.push({ tls: await initCycleTLS(), uses: 0, id: i });
  }
  let _poolRobin = 0;
  const TLS_RECYCLE_AFTER = 10; // recycle instance after N uses
  logger.info('CycleTLS pool ready (' + poolSize + ')');

  function getTLS() {
    const entry = tlsPool[_poolRobin % poolSize];
    _poolRobin++;
    return entry;
  }

  async function releaseTLS(entry) {
    entry.uses++;
    if (entry.uses >= TLS_RECYCLE_AFTER) {
      try { await entry.tls.exit(); } catch {}
      entry.tls = await initCycleTLS();
      entry.uses = 0;
    }
  }

  async function runOneSignup(account, proxyUrl, slot) {
    const log = logger.withContext(slot, account.email);
    const tlsEntry = getTLS();
    const cycleTLS = tlsEntry.tls;

    try {
      log.info('📧 Bắt đầu');

      // Snapshot existing emails
      const existingMessages = await getMessages(
        account.email, account.refreshToken, account.clientId
      );
      const seenUids = snapshotExistingUids(existingMessages);
      const usedCodes = new Set();
      if (Array.isArray(existingMessages)) {
        for (const msg of existingMessages) {
          const body = msg.body || msg.bodyPreview || msg.subject || '';
          const m = body.match(/\b(\d{6})\b/);
          if (m) usedCodes.add(m[1]);
        }
      }

      const maxAttempts = retries || 3;
      let result;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          log.warn('Retry ' + attempt + '/' + (maxAttempts - 1));
          await new Promise(r => setTimeout(r, 2000));
        }

        const deviceId = attempt > 0 ? uuidv4() : uuidv4();
        const sessionId = uuidv4();
        const sentinelId = uuidv4();
        const name = generateRandomName();
        const birthdate = generateRandomBirthday().full;

        try {
          result = await runSignupViaAPI(proxyUrl, {
            email: account.email,
            password: password,
            name, birthdate, deviceId, sessionId,
            sharedCycleTLS: cycleTLS,
            sentinelFn: async (flow, cookies, tlsFn) => {
              try {
                return await generateSentinelTokens(proxyUrl, '', flow, sentinelId, tlsFn || cycleTLS);
              } catch { return null; }
            },
            otpFn: async () => {
              if (!seenUids._usedCodes) seenUids._usedCodes = new Set();
              for (const c of usedCodes) seenUids._usedCodes.add(c);
              const otp = await waitForOtp(account.email, account.refreshToken, account.clientId, 120, seenUids);
              if (otp) usedCodes.add(String(otp));
              return otp;
            },
            onStep: step => {
              // Extract [X/7] from step message
              const sm = step.match(/^\[(\d+\/\d+)\]\s*/);
              if (sm) {
                const s = sm[1], msg = step.substring(sm[0].length);
                const level = msg.includes('❌') ? 'error' : msg.includes('⚠️') ? 'warn' : msg.includes('✅') || msg.includes('OK') ? 'success' : 'info';
                log[level]('[' + s + '] ' + msg);
              } else {
                log.info(step);
              }
            },
          });
        } catch (e) {
          const msg = e.message?.includes('socket') || e.message?.includes('ECONN') || e.message?.includes('ETIMEDOUT')
            ? 'Network error' : e.message;
          if (attempt < maxAttempts - 1) {
            log.warn('⚠️ ' + msg);
            continue;
          }
          log.error('❌ ' + msg);
          failCount++;
          return;
        }

        if (result.success) {
          const accessToken = result.accessToken || result.sessionData?.accessToken || '';

          // 2FA
          let twoFaSecret = '';
          if (accessToken) {
            try {
              const secret = await enable2FAAPI(accessToken, proxyUrl, account.email, cycleTLS);
              if (secret) {
                twoFaSecret = secret;
                log.success('[6/7] 🔐 2FA: ' + secret);
              } else {
                log.warn('[6/7] ⚠️ 2FA failed');
              }
            } catch (e) {
              log.error('[6/7] ❌ 2FA: ' + e.message);
            }
          }

          log.success('[7/7] ✅ Done');
          fileWriter.writeResultToXlsx({
            email: account.email,
            chatgptPassword: password,
            twoFa: twoFaSecret,
            sessionData: result.sessionData || null,
            hotmailInfo: account,
            status: 'SUCCESS',
          });
          fileWriter.removeFromHotmailXlsx(account.email, hotmailFile);
          successCount++;
          return;
        }

        // Handle failure
        const { step, error, data } = result;
        let errorMsg = error || '';
        try {
          const parsed = typeof data === 'object' ? data : JSON.parse(error);
          errorMsg = parsed?.error?.message || parsed?.detail || parsed?.message || error;
        } catch {}

        const noRetryMsg = (errorMsg || '').toLowerCase();
        if (noRetryMsg.includes('already registered') || noRetryMsg.includes('already exists')) {
          log.warn('⏩ Already registered');
          fileWriter.removeFromHotmailXlsx(account.email, hotmailFile);
          failCount++;
          return;
        }
        if (step === 'otp') {
          log.error('❌ OTP timeout');
          failCount++;
          return;
        }
        if (step === 'create_account' && data?.error?.code === 'unsupported_country') {
          log.error('❌ Country not supported');
          failCount++;
          return;
        }

        if (attempt >= maxAttempts - 1) {
          log.error('❌ ' + (step || '?') + ': ' + (errorMsg || 'All retries exhausted'));
          failCount++;
          return;
        }
        log.warn('⚠️ ' + (step || '?') + ': ' + errorMsg);
      }

      failCount++;
    } catch (e) {
      logger.withContext(slot, account.email).error('💥 Fatal: ' + e.message);
      failCount++;
    } finally {
      completedCount++;
      await releaseTLS(tlsEntry);
      printProgress(successCount, failCount, completedCount, total);
    }
  }

  // Semaphore: run N tasks concurrently
  const running = new Set();
  let taskIndex = 0;

  await new Promise(resolve => {
    function next() {
      while (running.size < threadCount && taskIndex < total) {
        const idx = taskIndex++;
        const slot = (idx % threadCount) + 1;
        const proxyUrl = assignProxy(proxies, idx);
        const task = runOneSignup(accounts[idx], proxyUrl, slot).then(() => {
          running.delete(task);
          if (taskIndex < total) next();
          if (running.size === 0 && taskIndex >= total) {
            printSummary(successCount, failCount, total);
            resolve();
          }
        });
        running.add(task);
      }
    }

    // Stagger start 3s apart
    for (let i = 0; i < Math.min(threadCount, total); i++) {
      setTimeout(() => next(), i * 3000);
    }
  });

  // Cleanup CycleTLS pool
  for (const entry of tlsPool) {
    try { await entry.tls.exit(); } catch {}
  }
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

// ── Autopay Mode (Multi-Thread + Device Pool) ─────────────────────────

async function runMultiThreadAutopay(proxies, gopayDevices, threadCount) {
  let payAccounts = fileWriter.getAccountsForAutopay();
  if (payAccounts.length === 0) {
    logger.error('Không có account nào có accessToken trong Account_ChatGPT_Data.xlsx');
    return;
  }

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

  const total = payAccounts.length;
  const actualThreads = Math.min(threadCount, total);
  const gopayCountryCode = '62';

  console.log('  Mode        ' + C.green + 'Autopay Multi-Thread' + C.reset);
  console.log('  Accounts    ' + C.yellow + total + C.reset);
  console.log('  Threads     ' + C.yellow + actualThreads + C.reset);
  console.log('  Devices     ' + C.green + gopayDevices.length + C.reset + C.gray + ' (max ' + gopayDevices.length + ' cùng lúc)' + C.reset);
  console.log('  Proxies     ' + (proxies.length > 0 ? C.green + proxies.length : C.yellow + 'Direct') + C.reset);
  console.log(C.cyan + '───────────────────────────────────────' + C.reset);
  console.log('');

  const devicePool = new DevicePool(gopayDevices);
  let successCount = 0;
  let failCount = 0;
  let completedCount = 0;

  // CycleTLS Pool
  const poolSize = Math.max(2, Math.min(5, Math.ceil(actualThreads / 3)));
  logger.info('Initializing CycleTLS pool (' + poolSize + ')...');
  const tlsPool = [];
  for (let i = 0; i < poolSize; i++) {
    tlsPool.push({ tls: await initCycleTLS(), uses: 0, id: i });
  }
  let _poolRobin = 0;
  const TLS_RECYCLE_AFTER = 10;

  function getTLS() {
    const entry = tlsPool[_poolRobin % poolSize];
    _poolRobin++;
    return entry;
  }

  async function releaseTLS(entry) {
    entry.uses++;
    if (entry.uses >= TLS_RECYCLE_AFTER) {
      try { await entry.tls.exit(); } catch {}
      entry.tls = await initCycleTLS();
      entry.uses = 0;
    }
  }

  async function runOneAutopay(acc, proxyUrl, slot) {
    const log = logger.withContext(slot, acc.email);
    const tlsEntry = getTLS();
    let device = null;

    try {
      log.info('⏳ Acquiring device...');
      device = await devicePool.acquire();
      log.info('📱 Device: +62' + device.phone + ' (idx=' + device.index + ')');

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
        gopayPhone: device.phone,
        gopayPin: device.pin,
        threadId: slot,
        sharedCycleTLS: tlsEntry.tls,
        adbPath: process.env.MUMU_ADB_PATH || null,
        deviceSerial: device.adbSerial || null,
      });

      const result = await autopay.runAutopay();
      if (result.success) {
        log.success('✅ ChatGPT Plus activated!');
        await fileWriter.markAccountAsPlusInXlsx(acc.email);
        successCount++;
      } else {
        if (!result.noRetry) log.error(result.error || 'Unknown error');
        if (result.hint) log.warn(result.hint);
        failCount++;
      }
    } catch (e) {
      log.error('💥 ' + e.message);
      failCount++;
    } finally {
      completedCount++;
      if (device) devicePool.release(device);
      await releaseTLS(tlsEntry);
      const rem = total - completedCount;
      console.log(
        C.gray + '  Progress: ' + C.reset +
        C.green + successCount + ' ✅' + C.reset + ' | ' +
        C.red + failCount + ' ❌' + C.reset + ' | ' +
        C.yellow + rem + ' remaining' + C.reset +
        ' (' + completedCount + '/' + total + ')'
      );
    }
  }

  // Semaphore: run N tasks concurrently
  const running = new Set();
  let taskIndex = 0;

  await new Promise(resolve => {
    function next() {
      while (running.size < actualThreads && taskIndex < total) {
        const idx = taskIndex++;
        const slot = (idx % actualThreads) + 1;
        const proxyUrl = proxies.length > 0 ? proxies[idx % proxies.length] : null;
        const task = runOneAutopay(payAccounts[idx], proxyUrl, slot).then(() => {
          running.delete(task);
          if (taskIndex < total) next();
          if (running.size === 0 && taskIndex >= total) resolve();
        });
        running.add(task);
      }
    }
    for (let i = 0; i < Math.min(actualThreads, total); i++) {
      setTimeout(() => next(), i * 2000);
    }
  });

  // Cleanup CycleTLS pool
  for (const entry of tlsPool) {
    try { await entry.tls.exit(); } catch {}
  }

  console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
  console.log(C.bold + C.white + ' AUTOPAY DONE' + C.reset);
  console.log(C.cyan + '───────────────────────────────────────────' + C.reset);
  console.log('  ' + C.green + '✅ Success    : ' + successCount + C.reset);
  console.log('  ' + C.red + '❌ Failed     : ' + failCount + C.reset);
  console.log('  ' + C.yellow + '  Total      : ' + total + C.reset);
  console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);
}


// ── Signup + Autopay Combined (Multi-Thread + Device Pool) ─────────────

async function runMultiThreadSignupAutopay(accounts, proxies, gopayDevices, threadCount) {
  if (!gopayDevices || gopayDevices.length === 0) {
    logger.error('Không có GoPay device nào. Rename MuMu instance thành PHONE_PIN.');
    return;
  }

  const gopayCountryCode = '62';
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
  if (total === 0) {
    logger.info('Không còn account nào cần xử lý.');
    return;
  }
  const actualThreads = Math.min(threadCount, total);

  console.log('  Mode        ' + C.green + 'Signup + Autopay Multi-Thread' + C.reset);
  console.log('  Accounts    ' + C.yellow + total + C.reset);
  console.log('  Threads     ' + C.yellow + actualThreads + C.reset);
  console.log('  Devices     ' + C.green + gopayDevices.length + C.reset + C.gray + ' (max ' + gopayDevices.length + ' autopay cùng lúc)' + C.reset);
  console.log('  Proxies     ' + (proxies.length > 0 ? C.green + proxies.length : C.yellow + 'Direct') + C.reset);
  console.log('  Password    ' + C.gray + password.substring(0, 3) + '***' + C.reset);
  console.log(C.cyan + '───────────────────────────────────────' + C.reset);
  console.log('');

  const devicePool = new DevicePool(gopayDevices);
  let signupSuccess = 0;
  let signupFail = 0;
  let autopaySuccess = 0;
  let autopayFail = 0;
  let completedCount = 0;

  // CycleTLS Pool
  const poolSize = Math.max(2, Math.min(5, Math.ceil(actualThreads / 3)));
  logger.info('Initializing CycleTLS pool (' + poolSize + ')...');
  const tlsPool = [];
  for (let i = 0; i < poolSize; i++) {
    tlsPool.push({ tls: await initCycleTLS(), uses: 0, id: i });
  }
  let _poolRobin = 0;
  const TLS_RECYCLE_AFTER = 10;

  function getTLS() {
    const entry = tlsPool[_poolRobin % poolSize];
    _poolRobin++;
    return entry;
  }

  async function releaseTLS(entry) {
    entry.uses++;
    if (entry.uses >= TLS_RECYCLE_AFTER) {
      try { await entry.tls.exit(); } catch {}
      entry.tls = await initCycleTLS();
      entry.uses = 0;
    }
  }

  async function runOneSignupAutopay(account, proxyUrl, slot) {
    const log = logger.withContext(slot, account.email);
    const tlsEntry = getTLS();
    const cycleTLS = tlsEntry.tls;

    try {
      // ── PHASE 1: Signup (NO device needed) ──
      log.info('📧 Bắt đầu Signup...');
      const signupResult = await runSingleSignup(account, proxyUrl, slot, cycleTLS);

      if (!signupResult.success) {
        log.error(signupResult.error);
        signupFail++;
        return;
      }

      const accessToken = signupResult.accessToken || signupResult.sessionData?.accessToken || '';

      // Enable 2FA
      let twoFaSecret = '';
      if (accessToken) {
        try {
          const secret = await enable2FAAPI(accessToken, proxyUrl, account.email, cycleTLS);
          if (secret) {
            twoFaSecret = secret;
            log.success('[6/7] 🔐 2FA: ' + secret);
          } else {
            log.warn('[6/7] ⚠️ 2FA failed');
          }
        } catch (e) {
          log.error('[6/7] ❌ 2FA: ' + e.message);
        }
      }

      fileWriter.writeResultToXlsx({
        email: signupResult.email,
        chatgptPassword: password,
        twoFa: twoFaSecret,
        sessionData: signupResult.sessionData || null,
        hotmailInfo: account,
        status: 'SUCCESS',
      });
      fileWriter.removeFromHotmailXlsx(account.email, hotmailFile);
      registeredEmails.add(account.email.toLowerCase().trim());
      log.success('[7/7] Signup hoàn tất');
      signupSuccess++;

      // ── PHASE 2: Autopay (NEEDS device) ──
      if (!accessToken) {
        log.warn('Bỏ qua autopay (không có accessToken)');
        autopayFail++;
        return;
      }

      let device = null;
      try {
        log.info('⏳ Acquiring device for autopay...');
        device = await devicePool.acquire();
        log.info('📱 Autopay → device: +' + gopayCountryCode + device.phone);

        const autopay = new ChatGPTAutopay({
          email: signupResult.email,
          password: password,
          name: signupResult.email.split('@')[0],
          accessToken: accessToken,
          skipLogin: true,
          skipOtp: true,
          proxyUrl: proxyUrl || null,
          checkoutProxyUrl: proxyUrl || null,
          gopayCountryCode,
          gopayPhone: device.phone,
          gopayPin: device.pin,
          threadId: slot,
          sharedCycleTLS: cycleTLS,
          adbPath: process.env.MUMU_ADB_PATH || null,
          deviceSerial: device.adbSerial || null,
        });

        const payResult = await autopay.runAutopay();
        if (payResult.success) {
          log.success('✅ ChatGPT Plus activated!');
          await fileWriter.markAccountAsPlusInXlsx(signupResult.email);
          autopaySuccess++;
        } else {
          log.error(payResult.error || 'Unknown error');
          if (payResult.hint) log.warn(payResult.hint);
          autopayFail++;
        }
      } catch (e) {
        log.error('💥 Autopay: ' + e.message);
        autopayFail++;
      } finally {
        if (device) devicePool.release(device);
      }
    } catch (e) {
      log.error('💥 Fatal: ' + e.message);
      signupFail++;
    } finally {
      completedCount++;
      await releaseTLS(tlsEntry);
      console.log(
        C.gray + '  Progress: ' + C.reset +
        C.green + 'Signup ' + signupSuccess + '✅' + C.reset + ' | ' +
        C.red + signupFail + '❌' + C.reset + ' | ' +
        C.green + 'Autopay ' + autopaySuccess + '✅' + C.reset + ' | ' +
        C.red + autopayFail + '❌' + C.reset +
        ' (' + completedCount + '/' + total + ')'
      );
    }
  }

  // Semaphore: run N tasks concurrently
  const running = new Set();
  let taskIndex = 0;

  await new Promise(resolve => {
    function next() {
      while (running.size < actualThreads && taskIndex < total) {
        const idx = taskIndex++;
        const slot = (idx % actualThreads) + 1;
        const proxyUrl = proxies.length > 0 ? proxies[idx % proxies.length] : null;
        const task = runOneSignupAutopay(accounts[idx], proxyUrl, slot).then(() => {
          running.delete(task);
          if (taskIndex < total) next();
          if (running.size === 0 && taskIndex >= total) resolve();
        });
        running.add(task);
      }
    }
    for (let i = 0; i < Math.min(actualThreads, total); i++) {
      setTimeout(() => next(), i * 3000);
    }
  });

  // Cleanup CycleTLS pool
  for (const entry of tlsPool) {
    try { await entry.tls.exit(); } catch {}
  }

  console.log('\n' + C.cyan + '═══════════════════════════════════════════' + C.reset);
  console.log(C.bold + C.white + ' SIGNUP + AUTOPAY DONE' + C.reset);
  console.log(C.cyan + '───────────────────────────────────────────' + C.reset);
  console.log('  Signup   ' + C.green + signupSuccess + ' ✅' + C.reset + ' | ' + C.red + signupFail + ' ❌' + C.reset + ' / ' + C.yellow + total + C.reset);
  console.log('  Autopay  ' + C.green + autopaySuccess + ' ✅' + C.reset + ' | ' + C.red + autopayFail + ' ❌' + C.reset + ' / ' + C.yellow + signupSuccess + C.reset);
  console.log(C.cyan + '═══════════════════════════════════════════' + C.reset);
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
  console.log(B + '  ║' + gS + padV('   [3]  💳  Thanh toán GoPay (Autopay đa luồng)', W) + gE + B + '║' + R);
  console.log(B + '  ║' + gS + padV('   [4]  🔥  Signup + Autopay đa luồng', W) + gE + B + '║' + R);
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
    const threadInput = await getUserInput('Số luồng (VD: 3, 5, 10 — max cùng lúc = ' + gopayDevices.length + ' devices): ');
    const threadCount = parseInt(threadInput) || gopayDevices.length;
    await runMultiThreadAutopay(proxies, gopayDevices, threadCount);
  } else if (choice === '4') {
    if (!hasGopay) {
      console.log(C.red + '  ❌ GoPay không khả dụng! Cần rename MuMu instances sang PHONE_PIN.' + R);
      return;
    }
    const threadInput = await getUserInput('Số luồng (VD: 3, 5, 10 — max autopay cùng lúc = ' + gopayDevices.length + ' devices): ');
    const threadCount = parseInt(threadInput) || gopayDevices.length;
    await runMultiThreadSignupAutopay(accounts, proxies, gopayDevices, threadCount);

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
