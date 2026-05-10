let _stealthApplied = false;

function parseProxy(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const parsed = new URL(proxyUrl);
    return {
      server: parsed.hostname + ':' + parsed.port,
      username: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || '')
    };
  } catch {
    return null;
  }
}

function loadPuppeteer() {
  let pptr;
  let stealth;
  try {
    pptr = require('puppeteer-extra');
    stealth = require('puppeteer-extra-plugin-stealth');
  } catch {
    throw new Error("Missing deps — run: npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth");
  }
  if (!_stealthApplied) {
    pptr.use(stealth());
    _stealthApplied = true;
  }
  return pptr;
}

async function launchBrowser(pptr, proxyUrl) {
  const proxy = parseProxy(proxyUrl);
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,720'
  ];
  if (proxy?.server) {
    args.push('--proxy-server=' + proxy.server);
  }
  const fs = require('fs');
  const chromePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const execPath = chromePaths.find(p => {
    try { return fs.existsSync(p); } catch { return false; }
  });
  const headless = !(process.env.BROWSER_HEADLESS === '0');
  const launchOpts = {
    headless,
    args,
    ignoreHTTPSErrors: true
  };
  if (execPath) {
    launchOpts.executablePath = execPath;
  }
  const browser = await pptr.launch(launchOpts);
  const page = await browser.newPage();
  if (proxy?.username) {
    await page.authenticate({
      username: proxy.username,
      password: proxy.password
    });
  }
  await page.setViewport({ width: 1280, height: 720 });
  return { browser, page };
}

async function waitForCfClearance(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const cookies = await page.cookies('https://chatgpt.com');
    if (cookies.some(c => c.name === 'cf_clearance')) {
      return true;
    }
    const content = await page.content().catch(() => '');
    if (!content.includes('cf_chl_opt') && !content.includes('challenge-platform')) {
      return false;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

async function getAuthSession(proxyUrl, { email, deviceId, sessionId }) {
  const pptr = loadPuppeteer();
  const { browser, page } = await launchBrowser(pptr, proxyUrl);
  try {
    await page.goto("https://chatgpt.com/", {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }).catch(err => {
      if (!err.message?.includes('timeout') && !err.message?.includes('net::')) throw err;
    });
    await waitForCfClearance(page);
    await new Promise(r => setTimeout(r, 2000));

    let csrfToken = null;
    for (let i = 0; i < 4; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      csrfToken = await page.evaluate(async base => {
        try {
          const res = await fetch(base + '/api/auth/csrf', { credentials: 'same-origin' });
          const data = await res.json().catch(() => null);
          return data?.csrfToken || null;
        } catch { return null; }
      }, 'https://chatgpt.com');
      if (csrfToken) break;
    }
    if (!csrfToken) throw new Error("CSRF fetch failed inside browser");

    const signinQuery = new URLSearchParams({
      prompt: 'login',
      'ext-oai-did': deviceId,
      auth_session_logging_id: sessionId,
      screen_hint: 'login_or_signup',
      login_hint: email
    }).toString();
    const signinBody = new URLSearchParams({
      callbackUrl: "https://chatgpt.com/",
      csrfToken,
      json: 'true'
    }).toString();

    const authorizeUrl = await page.evaluate(async (base, query, body) => {
      const res = await fetch(base + '/api/auth/signin/openai?' + query, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => null);
      return data?.url || null;
    }, 'https://chatgpt.com', signinQuery, signinBody);

    if (!authorizeUrl) throw new Error("Signin failed — no authorize URL returned");

    await page.goto(authorizeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(err => {
      if (!err.message?.includes('timeout') && !err.message?.includes('net::')) throw err;
    });
    await page.waitForFunction(
      () => location.href.includes('/create-account/') || location.href.includes('/email-verification'),
      { timeout: 45000, polling: 200 }
    ).catch(() => {});

    const chatgptCookies = await page.cookies("https://chatgpt.com/");
    const authCookies = await page.cookies("https://auth.openai.com/");
    return {
      csrfToken,
      authorizeUrl,
      cookies: [...chatgptCookies, ...authCookies],
      page,
      browser
    };
  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

async function runSignupViaBrowser(proxyUrl, {
  email, password, name, birthdate, deviceId, sessionId, sentinelFn, otpFn, onStep
}) {
  const pptr = loadPuppeteer();
  const { browser, page } = await launchBrowser(pptr, proxyUrl);
  try {
    onStep?.("CF solve (chatgpt.com)");
    await page.goto("https://chatgpt.com/", {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }).catch(err => {
      if (!err.message?.includes('timeout') && !err.message?.includes('net::')) throw err;
    });
    await waitForCfClearance(page);
    onStep?.("CSRF ✓");

    let csrfToken = null;
    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      csrfToken = await page.evaluate(async base => {
        try {
          const res = await fetch(base + '/api/auth/csrf', { credentials: 'same-origin' });
          return (await res.json().catch(() => null))?.csrfToken || null;
        } catch { return null; }
      }, 'https://chatgpt.com');
      if (csrfToken) break;
    }
    if (!csrfToken) return { success: false, step: 'csrf', error: "CSRF failed in browser" };

    onStep?.('Signin');
    const signinQuery = new URLSearchParams({
      prompt: 'login',
      'ext-oai-did': deviceId,
      auth_session_logging_id: sessionId,
      screen_hint: 'login_or_signup',
      login_hint: email
    }).toString();
    const signinBody = new URLSearchParams({
      callbackUrl: "https://chatgpt.com/",
      csrfToken,
      json: 'true'
    }).toString();

    const authorizeUrl = await page.evaluate(async (base, query, body) => {
      const res = await fetch(base + '/api/auth/signin/openai?' + query, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'same-origin'
      });
      return (await res.json().catch(() => null))?.url || null;
    }, 'https://chatgpt.com', signinQuery, signinBody);

    if (!authorizeUrl) return { success: false, step: 'signin', error: "No authorize URL from signin" };

    onStep?.("Authorize + Sentinel (parallel)");
    const [, sentinelToken] = await Promise.all([
      (async () => {
        await page.goto(authorizeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        }).catch(err => {
          if (!err.message?.includes('timeout') && !err.message?.includes('net::')) throw err;
        });
        await page.waitForFunction(
          () => location.href.includes('/create-account/') || location.href.includes('/email-verification'),
          { timeout: 45000, polling: 200 }
        ).catch(() => {});
        await page.waitForSelector("input[type=\"password\"]", { timeout: 30000 }).catch(() => {});
      })(),
      (async () => {
        try { return await sentinelFn?.(); } catch { return null; }
      })()
    ]);

    const authCookies = await page.cookies("https://auth.openai.com/");
    onStep?.("Register (page: " + page.url().replace('https://auth.openai.com', '') + " | " + authCookies.length + " cookies)");

    await page.waitForSelector("input[type=\"password\"]", { timeout: 20000 }).catch(() => {});

    let registerStatus = null;
    let registerData = null;
    const onRegisterResponse = async res => {
      if (res.url().includes('/api/accounts/user/register')) {
        registerStatus = res.status();
        registerData = await res.json().catch(() => null);
      }
    };
    page.on('response', onRegisterResponse);

    try {
      await page.focus("input[type=\"password\"]");
      await page.type("input[type=\"password\"]", password, { delay: 80 });
      await page.waitForFunction(() => {
        const btn = document.querySelector("button[type=\"submit\"]") ||
          Array.from(document.querySelectorAll('button')).find(b => /continue|create|next/i.test(b.textContent));
        return btn && !btn.disabled && !btn.getAttribute('aria-disabled');
      }, { timeout: 8000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector("button[type=\"submit\"]") ||
          Array.from(document.querySelectorAll('button')).find(b => /continue|create|next/i.test(b.textContent));
        if (btn) { btn.click(); return btn.textContent?.trim() || 'clicked'; }
        return false;
      });
      if (!clicked) {
        await page.focus("input[type=\"password\"]");
        await page.keyboard.press('Enter');
      }
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && registerStatus === null) {
        await new Promise(r => setTimeout(r, 200));
      }
    } finally {
      page.off('response', onRegisterResponse);
    }

    if (registerStatus === null) {
      onStep?.("Register fallback (direct fetch)");
      const fallback = await page.evaluate(async (base, payload, sentinel) => {
        const headers = { 'Content-Type': 'application/json' };
        if (sentinel) headers['openai-sentinel-token'] = sentinel;
        const res = await fetch(base + '/api/accounts/user/register', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          credentials: 'include'
        });
        return { status: res.status, data: await res.json().catch(() => null) };
      }, 'https://auth.openai.com', { password, username: email }, sentinelToken);
      registerStatus = fallback.status;
      registerData = fallback.data;
    }

    if (registerStatus !== 200) {
      return { success: false, step: 'register', status: registerStatus, data: registerData };
    }

    onStep?.("OTP send");
    await page.evaluate(async base => {
      await fetch(base + '/api/accounts/email-otp/send', { credentials: 'include' });
    }, 'https://auth.openai.com');

    onStep?.("OTP wait");
    const otp = await otpFn?.();
    if (!otp) return { success: false, step: 'otp', error: "OTP not received" };

    onStep?.("OTP validate (" + otp + ')');
    const otpResult = await page.evaluate(async (base, code) => {
      const res = await fetch(base + '/api/accounts/email-otp/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': base,
          'Referer': base + '/email-verification'
        },
        body: JSON.stringify({ code }),
        credentials: 'include'
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    }, 'https://auth.openai.com', otp.toString());

    if (otpResult.status !== 200) {
      return { success: false, step: 'otp_validate', status: otpResult.status, data: otpResult.data };
    }

    onStep?.("Create account");
    const createResult = await page.evaluate(async (base, payload) => {
      const res = await fetch(base + '/api/accounts/create_account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': base,
          'Referer': base + '/about-you'
        },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    }, 'https://auth.openai.com', { name, birthdate });

    if (createResult.status !== 200) {
      return { success: false, step: 'create_account', status: createResult.status, data: createResult.data };
    }

    return { success: true };
  } finally {
    await browser.close();
  }
}

module.exports = { runSignupViaBrowser, getAuthSession };
