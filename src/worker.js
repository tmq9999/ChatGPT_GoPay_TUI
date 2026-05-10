/**
 * Worker Thread — Signup Worker
 */

const { parentPort, workerData } = require('worker_threads');
const { v4: uuidv4 } = require('uuid');
const initCycleTLS = require('cycletls');
const { waitForOtp, snapshotExistingUids, getMessages } = require('./utils/hotmailReader');
const { generateRandomName, generateRandomBirthday } = require('./utils/emailGenerator');
const { generateSentinelTokens } = require('./utils/sentinelToken');
const { enable2FAAPI } = require('./utils/twoFactorSetup');

const {
  hotmailAccount,
  proxyUrl,
  threadId,
  chatgptPassword,
  retries,
} = workerData;

// COLOR_RULE.md — Chuẩn hóa màu
const LEVEL_COLORS = {
  info:    '\x1b[96m',   // Cyan — Normal logging
  success: '\x1b[92m',   // Light Green — Success
  warn:    '\x1b[93m',   // Light Yellow — Warning
  error:   '\x1b[91m',   // Red — Error
};
const R = '\x1b[0m';
const email = hotmailAccount.email;

function ts() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

// Format: [HH:MM:SS] - [#TX] - [email] - [step] - [message]
// level: 'info' | 'success' | 'warn' | 'error'
function log(rawMsg, level) {
  if (!level) {
    // Auto-detect level from content
    if (rawMsg.includes('❌') || rawMsg.includes('Fatal')) level = 'error';
    else if (rawMsg.includes('⚠️') || rawMsg.includes('Retry')) level = 'warn';
    else if (rawMsg.includes('✅') || rawMsg.includes('OK') || rawMsg.includes('Done') || rawMsg.includes('Saved')) level = 'success';
    else level = 'info';
  }
  const color = LEVEL_COLORS[level] || LEVEL_COLORS.info;

  // Extract step like [X/7] from message
  const stepMatch = rawMsg.match(/^\[(\d+\/\d+)\]\s*/);
  let step = '-';
  let msg = rawMsg;
  if (stepMatch) {
    step = stepMatch[1];
    msg = rawMsg.substring(stepMatch[0].length);
  }

  console.log(color + '[' + ts() + '] - [#T' + threadId + '] - [' + email + '] - [' + step + '] - ' + msg + R);
}

function send(type, data) {
  parentPort.postMessage({ type, threadId, ...data });
}

// Promise with timeout
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout (' + ms + 'ms)')), ms)),
  ]);
}

async function runSignup() {
  let cycleTLS = null;

  try {
    send('status', { status: 'starting', email });

    // 1. Init CycleTLS
    cycleTLS = await initCycleTLS();

    // 2. Snapshot existing emails
    const existingMessages = await getMessages(
      hotmailAccount.email,
      hotmailAccount.refreshToken,
      hotmailAccount.clientId
    );
    const seenUids = snapshotExistingUids(existingMessages);
    const usedCodes = new Set();
    if (Array.isArray(existingMessages)) {
      for (const msg of existingMessages) {
        const body = msg.body || msg.bodyPreview || msg.subject || '';
        const match = body.match(/\b(\d{6})\b/);
        if (match) usedCodes.add(match[1]);
      }
    }

    // 3. Signup
    const { runSignupViaAPI } = require('./utils/apiSignup');
    const deviceId = uuidv4();
    const sessionId = uuidv4();
    const sentinelId = uuidv4();
    const name = generateRandomName();
    const birthdate = generateRandomBirthday().full;

    // retries = tổng số lần thử (bao gồm lần đầu)
    // 3 attempts = 1 lần đầu + 2 retry
    const maxAttempts = retries || 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        log('Retry ' + attempt + '/' + (maxAttempts - 1), 'warn');
        await new Promise(r => setTimeout(r, 2000));
      }

      let result;
      try {
        result = await withTimeout(
          runSignupViaAPI(proxyUrl, {
            email: hotmailAccount.email,
            password: chatgptPassword,
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
              if (!seenUids._usedCodes) seenUids._usedCodes = new Set();
              for (const c of usedCodes) seenUids._usedCodes.add(c);

              const otp = await waitForOtp(
                hotmailAccount.email,
                hotmailAccount.refreshToken,
                hotmailAccount.clientId,
                120,
                seenUids
              );
              if (otp) usedCodes.add(String(otp));
              return otp;
            },
            onStep: step => log(step),
          }),
          10000,
          'Signup attempt'
        );
      } catch (e) {
        const msg = e.message?.includes('socket') || e.message?.includes('ECONN') || e.message?.includes('ETIMEDOUT')
          ? 'Network error'
          : e.message;

        if (attempt < maxAttempts - 1) {
          log('⚠️ ' + msg, 'warn');
          // If timeout, CycleTLS may be stuck — recreate
          if (e.message?.includes('timeout')) {
            try { await withTimeout(cycleTLS.exit(), 3000, 'exit'); } catch {}
            cycleTLS = await initCycleTLS();
          }
          continue;
        }
        log('❌ ' + msg, 'error');
        send('result', { success: false, email, error: msg });
        return;
      }

      if (result.success) {
        const accessToken = result.accessToken || result.sessionData?.accessToken || '';

        // Enable 2FA with 15s timeout
        let twoFaSecret = '';
        if (accessToken) {
          try {
            const secret = await withTimeout(
              enable2FAAPI(accessToken, proxyUrl, email, cycleTLS),
              15000,
              '2FA'
            );
            if (secret) {
              twoFaSecret = secret;
              log('[6/7] 🔐 2FA: ' + secret, 'success');
            } else {
              log('[6/7] ⚠️ 2FA failed', 'warn');
            }
          } catch (e) {
            log('[6/7] ❌ 2FA: ' + e.message, 'error');
          }
        }

        log('[7/7] ✅ Done', 'success');
        send('result', {
          success: true,
          email,
          password: chatgptPassword,
          accessToken: accessToken || null,
          sessionToken: result.sessionData?.sessionToken || '',
          sessionData: result.sessionData || null,
          twoFaSecret,
          hotmailInfo: hotmailAccount,
        });
        return;
      }

      // Handle failures
      const { step, error, data } = result;
      let errorMsg = error || '';
      try {
        const parsed = typeof data === 'object' ? data : JSON.parse(error);
        errorMsg = parsed?.error?.message || parsed?.detail || parsed?.message || error;
      } catch {}

      // No-retry cases
      const noRetryMsg = (errorMsg || '').toLowerCase();
      if (noRetryMsg.includes('already registered') || noRetryMsg.includes('already exists')) {
        log('⏩ Already registered', 'warn');
        send('result', { success: false, email, error: 'Email already registered' });
        return;
      }
      if (step === 'otp') {
        log('❌ OTP timeout', 'error');
        send('result', { success: false, email, error: 'OTP not received' });
        return;
      }
      if (step === 'create_account' && data?.error?.code === 'unsupported_country') {
        log('❌ Country not supported', 'error');
        send('result', { success: false, email, error: 'Country not supported' });
        return;
      }

      // Retryable
      if (attempt >= maxAttempts - 1) {
        log('❌ ' + (step || '?') + ': ' + (errorMsg || 'All retries exhausted'), 'error');
        send('result', { success: false, email, error: errorMsg || 'All retries exhausted' });
        return;
      }
      log('⚠️ ' + (step || '?') + ': ' + errorMsg, 'warn');
    }

    send('result', { success: false, email, error: 'All retries exhausted' });
  } catch (e) {
    log('💥 Fatal: ' + e.message, 'error');
    send('result', { success: false, email, error: e.message });
  } finally {
    // CycleTLS cleanup with 5s timeout
    if (cycleTLS) {
      try {
        await withTimeout(cycleTLS.exit(), 5000, 'CycleTLS exit');
      } catch {
        // Force kill if exit hangs
        try { cycleTLS.exit(); } catch {}
      }
    }
    send('done', {});
  }
}

runSignup();
