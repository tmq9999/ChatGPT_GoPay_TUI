/**
 * 2FA Enabler via Camoufox (anti-detect Firefox) + Playwright
 *
 * Flow:
 *   1. Launch Camoufox with session cookie → chatgpt.com
 *   2. Dismiss onboarding/modals
 *   3. Navigate to Settings → Security
 *   4. Click MFA authenticator toggle
 *   5. Wait for QR code
 *   6. Click "Trouble scanning?" → reveal plaintext TOTP secret
 *   7. Extract secret (base32)
 *   8. Generate TOTP code, fill + verify
 *   9. Return secret
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { firefox } = require('playwright');
const logger = require('./logger');

// Camoufox executable path (installed via `npx camoufox fetch`)
function getCamoufoxPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA, 'camoufox', 'camoufox', 'Cache', 'camoufox.exe');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME, 'Library', 'Caches', 'camoufox', 'camoufox');
  }
  return path.join(process.env.HOME, '.cache', 'camoufox', 'camoufox');
}

// ── Base32 + TOTP ──────────────────────────────────────────────────────────────

function base32Decode(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of encoded.toUpperCase().replace(/=+$/, '')) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret, period = 30) {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(time / 0x100000000), 0);
  buf.writeUInt32BE(time & 0xFFFFFFFF, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 |
                (hmac[offset + 1] & 0xff) << 16 |
                (hmac[offset + 2] & 0xff) << 8 |
                (hmac[offset + 3] & 0xff)) % 1000000;
  return code.toString().padStart(6, '0');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dismissModals(page) {
  const dismissTexts = [
    'Skip tour', 'Skip Tour', 'Skip', 'Block',
    "Okay, let's go", 'Okay', 'Done', 'OK',
    'Dismiss', 'Close', 'Not now',
  ];
  for (let round = 0; round < 8; round++) {
    const clicked = await page.evaluate((texts) => {
      const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
      for (const wanted of texts) {
        const hit = nodes.find(n => {
          const txt = (n.textContent || '').trim();
          return txt.toLowerCase() === wanted.toLowerCase();
        });
        if (hit) {
          const r = hit.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { hit.click(); return wanted; }
        }
      }
      const modal = document.querySelector('#modal-onboarding');
      if (modal) {
        const r = modal.getBoundingClientRect();
        if (r.width > 100 && r.height > 100) {
          const btn = modal.querySelector('button');
          if (btn) { btn.click(); return 'modal-onboarding-btn'; }
          modal.remove();
          return 'modal-onboarding-removed';
        }
      }
      return null;
    }, dismissTexts);
    if (!clicked) break;
    await sleep(400);
  }
}

async function has2FAKeywords(page) {
  const body = await page.evaluate(() => document.body.innerText.toLowerCase());
  return ['multi-factor', 'mfa', 'two-factor', 'authenticator', '2fa'].some(kw => body.includes(kw));
}

async function extractTotpSecret(page) {
  // Strategy 0: otpauth:// link
  const fromLink = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    for (const a of links) {
      const href = a.href || a.getAttribute('href') || '';
      if (href.includes('otpauth://')) {
        const m = href.match(/secret=([A-Z2-7]+)/i);
        if (m) return m[1].toUpperCase();
      }
    }
    return null;
  });
  if (fromLink) return fromLink;

  // Strategy 1: scan visible text for base32
  const fromText = await page.evaluate(() => {
    const allText = document.body.innerText || '';
    const matches = allText.match(/\b[A-Z2-7]{16,64}\b/g);
    if (!matches) return null;
    const common = new Set(['CONTINUE','ENABLED','DISABLED','SETTINGS','ACCOUNT','SECURITY','PASSWORD','RECOVERY','VERIFIED']);
    for (const m of matches) {
      if (!common.has(m) && m.length >= 16) return m;
    }
    return null;
  });
  if (fromText) return fromText;

  // Strategy 2: specific selectors
  const selectors = [
    '[data-testid*="secret"]', '[aria-label*="secret" i]',
    '[class*="secret" i]', 'code', 'pre',
    'input[readonly]', '[class*="key" i]',
  ];
  for (const sel of selectors) {
    const val = await page.evaluate((s) => {
      const els = document.querySelectorAll(s);
      for (const el of els) {
        const text = (el.innerText || el.value || '').trim().replace(/\s/g, '').toUpperCase();
        if (/^[A-Z2-7]{16,64}$/.test(text)) return text;
      }
      return null;
    }, sel);
    if (val) return val;
  }

  return null;
}

// ── Main 2FA function ──────────────────────────────────────────────────────────

async function enable2FA(sessionToken, proxyUrl) {
  let browser = null;
  try {
    const camoufoxPath = getCamoufoxPath();
    if (!fs.existsSync(camoufoxPath)) {
      logger.error('[2FA] Camoufox not found: ' + camoufoxPath + ' → run: npx camoufox fetch');
      return null;
    }

    // Proxy config
    let proxyConfig = undefined;
    if (proxyUrl) {
      const m = proxyUrl.match(/\/\/(?:([^:]+):([^@]+)@)?(.+)/);
      if (m) {
        proxyConfig = { server: 'http://' + m[3] };
        if (m[1]) { proxyConfig.username = m[1]; proxyConfig.password = m[2]; }
      }
    }

    browser = await firefox.launch({
      executablePath: camoufoxPath,
      headless: false,
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    // Set session cookie
    await context.addCookies([{
      name: '__Secure-next-auth.session-token',
      value: sessionToken,
      domain: '.chatgpt.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }]);

    const page = await context.newPage();

    // Step 1: Navigate to chatgpt.com
    logger.info('[2FA] Mở chatgpt.com (Camoufox)...');
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    // Step 2: Dismiss modals
    await dismissModals(page);
    await sleep(1000);

    // Step 3: Navigate to security settings
    logger.info('[2FA] Mở Security settings...');
    let reached = false;
    const urls = [
      'https://chatgpt.com/settings/security',
      'https://chatgpt.com/#settings/Security',
      'https://chatgpt.com/#/settings/security',
    ];
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(2000);
        await dismissModals(page);
        if (await has2FAKeywords(page)) {
          reached = true;
          break;
        }
      } catch {}
    }

    if (!reached) {
      logger.warn('[2FA] Không mở được Security settings');
      return null;
    }

    // Step 4: Click mfa-authenticator-toggle
    logger.info('[2FA] Bật 2FA toggle...');
    const toggleClicked = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="mfa-authenticator-toggle"]');
      if (toggle) {
        const r = toggle.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          if (toggle.getAttribute('data-state') === 'unchecked') {
            toggle.click();
            return 'clicked';
          }
          return 'already-checked';
        }
      }
      const switches = [...document.querySelectorAll('[role="switch"], button[role="switch"]')];
      for (const sw of switches) {
        const parent = sw.closest('div, label');
        const text = (parent?.textContent || '').toLowerCase();
        if (['authenticator', 'two-factor', '2fa', 'mfa'].some(kw => text.includes(kw))) {
          sw.click();
          return 'fallback-clicked';
        }
      }
      return null;
    });

    if (!toggleClicked) {
      logger.warn('[2FA] Không tìm thấy 2FA toggle');
      return null;
    }
    logger.info('[2FA] Toggle: ' + toggleClicked);
    if (toggleClicked === 'already-checked') {
      logger.info('[2FA] 2FA đã bật sẵn');
      return null;
    }
    await sleep(2000);

    // Step 5: Wait for QR code
    logger.info('[2FA] Chờ QR code...');
    let qrFound = false;
    const qrDeadline = Date.now() + 25000;
    while (Date.now() < qrDeadline) {
      const found = await page.evaluate(() => {
        const sels = ['img[alt*="qr" i]', 'canvas', 'img[src*="qr" i]', '[data-testid*="qr"]'];
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return true;
          }
        }
        const body = document.body.innerText.toLowerCase();
        return ['scan this qr', 'authenticator app', 'scan the'].some(kw => body.includes(kw));
      });
      if (found) { qrFound = true; break; }
      await sleep(500);
    }

    if (!qrFound) {
      logger.warn('[2FA] QR code không xuất hiện');
      return null;
    }
    logger.info('[2FA] QR code detected');

    // Step 6: Click "Trouble scanning?" to reveal secret
    await sleep(1000);
    const troubleClicked = await page.evaluate(() => {
      const pattern = /trouble scanning\??|enter manually|can't scan|show key/i;
      const els = [...document.querySelectorAll('a, button, [role="button"]')];
      for (const el of els) {
        const text = (el.textContent || '').trim();
        if (pattern.test(text)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return text; }
        }
      }
      return null;
    });

    if (troubleClicked) {
      logger.info('[2FA] Clicked: ' + troubleClicked);
      await sleep(1500);
    }

    // Step 7: Extract TOTP secret
    const secret = await extractTotpSecret(page);
    if (!secret) {
      logger.warn('[2FA] Không lấy được TOTP secret từ page');
      return null;
    }
    logger.info('[2FA] Secret: ' + secret);

    // Step 8: Generate TOTP code and fill
    const code = generateTOTP(secret);
    logger.info('[2FA] TOTP code: ' + code);

    const codeSelectors = [
      'input[placeholder*="6-digit" i]',
      'input[placeholder*="code" i]',
      'input[autocomplete="one-time-code"]',
      'input[maxlength="6"]',
      'input[name="code"]',
      'input[type="tel"]',
    ];
    let filled = false;
    for (const sel of codeSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await el.fill(code);
          filled = true;
          break;
        }
      } catch {}
    }
    if (!filled) {
      await page.keyboard.type(code);
    }

    await sleep(500);

    // Submit
    const submitSelectors = [
      '[role="dialog"] button:has-text("Verify")',
      'button:has-text("Verify")',
      'button:has-text("Continue")',
      'button[type="submit"]',
    ];
    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const box = await btn.boundingBox();
          if (box && box.width > 0) { await btn.click(); break; }
        }
      } catch {}
    }

    await sleep(3000);

    // Verify success
    const success = await page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      const successWords = ['recovery codes', 'two-factor authentication enabled',
        'authenticator app added', 'mfa enabled', '2fa enabled'];
      return successWords.some(w => body.includes(w));
    });

    if (success) {
      logger.info('[2FA] ✅ 2FA bật thành công!');
    } else {
      // Retry once with fresh code
      logger.info('[2FA] Retry with fresh code...');
      await sleep(1500);
      const code2 = generateTOTP(secret);
      for (const sel of codeSelectors) {
        try {
          const el = await page.$(sel);
          if (el) { await el.fill(''); await el.fill(code2); break; }
        } catch {}
      }
      await sleep(500);
      for (const sel of submitSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) { await btn.click(); break; }
        } catch {}
      }
      await sleep(3000);
    }

    return secret;
  } catch (e) {
    logger.error('[2FA] Error: ' + e.message);
    return null;
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

// ── API-based 2FA (no browser needed) ──────────────────────────────────────────

async function enable2FAAPI(accessToken, proxyUrl, email, sharedTLS) {
  const tag = email ? (' ' + email) : '';
  const initCycleTLS = require('cycletls');
  let tls = sharedTLS || null;
  let ownTLS = false;
  try {
    if (!tls) {
      tls = await initCycleTLS();
      ownTLS = true;
    }
    const BASE = 'https://chatgpt.com';
    const headers = {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + accessToken,
      'Origin': BASE,
      'Referer': BASE + '/',
    };

    const enrollRes = await tls(BASE + '/backend-api/accounts/mfa/enroll', {
      body: JSON.stringify({ factor_type: 'totp' }),
      headers,
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
    }, 'post');

    let enrollData = enrollRes.body || enrollRes.data;
    if (typeof enrollData === 'string') {
      try { enrollData = JSON.parse(enrollData); } catch {}
    }

    if (!enrollData || enrollRes.status !== 200) {
      return null;
    }

    const totpUri = enrollData.totp_uri || enrollData.uri || '';
    const sessionId = enrollData.session_id || enrollData.id || '';
    let secret = null;

    if (enrollData.secret) secret = enrollData.secret;
    if (!secret && totpUri) {
      const m = totpUri.match(/secret=([A-Z2-7]+)/i);
      if (m) secret = m[1].toUpperCase();
    }
    if (!secret && enrollData.barcode_uri) {
      const m = enrollData.barcode_uri.match(/secret=([A-Z2-7]+)/i);
      if (m) secret = m[1].toUpperCase();
    }

    if (!secret) {
      return null;
    }



    const code = generateTOTP(secret);

    const activateRes = await tls(BASE + '/backend-api/accounts/mfa/user/activate_enrollment', {
      body: JSON.stringify({ code, factor_type: 'totp', session_id: sessionId }),
      headers,
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
    }, 'post');

    if (activateRes.status === 200) {
      return secret;
    }

    await new Promise(r => setTimeout(r, 2000));
    const code2 = generateTOTP(secret);

    const activate2Res = await tls(BASE + '/backend-api/accounts/mfa/user/activate_enrollment', {
      body: JSON.stringify({ code: code2, factor_type: 'totp', session_id: sessionId }),
      headers,
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
    }, 'post');

    if (activate2Res.status === 200) {
      return secret;
    }


    return null;
  } catch (e) {

    return null;
  } finally {
    // Only exit if we created our own CycleTLS
    if (ownTLS && tls) try { await tls.exit(); } catch {}
  }
}

module.exports = { enable2FA, enable2FAAPI, generateTOTP, base32Decode };
