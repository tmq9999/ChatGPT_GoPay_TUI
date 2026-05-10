const initCycleTLS = require('cycletls');
const logger = require('./logger');

const BASE = 'https://chatgpt.com';
const AUTH_BASE = 'https://auth.openai.com';
const CHROME_JA3 = '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
const CHROME_H2 = '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const CHROME_SEC_CH_UA = '"Chromium";v="147", "Not/A)Brand";v="24", "Google Chrome";v="147"';

class CookieJar {
  constructor() {
    this.store = new Map();
  }

  capture(headers, url) {
    if (!url || typeof url !== 'string') return;
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch { return; }
    const raw = headers?.['Set-Cookie'] || headers?.['set-cookie'];
    if (!raw) return;
    const cookies = Array.isArray(raw) ? raw : [raw];
    for (const cookie of cookies) {
      if (typeof cookie !== 'string') continue;
      const kv = cookie.match(/^([^=]+)=([^;]*)/);
      if (!kv) continue;
      const name = kv[1].trim();
      const value = kv[2];
      const domainMatch = cookie.match(/[;]\s*[Dd]omain=\.?([^;,\s]+)/i);
      const domain = domainMatch ? domainMatch[1].toLowerCase() : hostname;
      if (!this.store.has(domain)) this.store.set(domain, new Map());
      this.store.get(domain).set(name, value);
    }
  }

  headerFor(url) {
    const hostname = new URL(url).hostname;
    const parts = [];
    for (const [domain, jar] of this.store) {
      if (hostname === domain || hostname.endsWith('.' + domain) || domain.endsWith('.' + hostname) || hostname.includes(domain)) {
        for (const [name, value] of jar) {
          parts.push(name + '=' + value);
        }
      }
    }
    return parts.length ? parts.join('; ') : undefined;
  }

  count() {
    let total = 0;
    for (const jar of this.store.values()) total += jar.size;
    return total;
  }
}

class TLSSession {
  constructor(tls, proxyUrl) {
    this.tls = tls;
    this.proxy = proxyUrl || undefined;
    this.jar = new CookieJar();
  }

  _sanitizeHeaders(headers) {
    const out = {};
    for (const [key, val] of Object.entries(headers)) {
      if (val == null) continue;
      out[key] = Array.isArray(val) ? val[0] : String(val);
    }
    return out;
  }

  _baseOpts(url, extraHeaders = {}) {
    const cookieStr = this.jar.headerFor(url);
    return {
      ja3: CHROME_JA3,
      http2Fingerprint: CHROME_H2,
      userAgent: CHROME_UA,
      timeout: 60,
      proxy: this.proxy,
      disableRedirect: true,
      enableConnectionReuse: true,
      headers: this._sanitizeHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': CHROME_SEC_CH_UA,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        ...(cookieStr ? { Cookie: cookieStr } : {}),
        ...extraHeaders
      })
    };
  }

  async get(url, extraHeaders = {}) {
    const opts = this._baseOpts(url, {
      Accept: 'application/json',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...extraHeaders
    });
    const res = await this.tls(url, opts, 'get');
    this.jar.capture(res.headers, res.finalUrl || url);
    return res;
  }

  async getHtml(url, extraHeaders = {}) {
    const opts = this._baseOpts(url, {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      ...extraHeaders
    });
    const res = await this.tls(url, opts, 'get');
    this.jar.capture(res.headers, res.finalUrl || url);
    return res;
  }

  async post(url, body, extraHeaders = {}) {
    const opts = this._baseOpts(url, {
      Accept: 'application/json',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...extraHeaders
    });
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await this.tls(url, opts, 'post');
    this.jar.capture(res.headers, res.finalUrl || url);
    return res;
  }

  async followRedirects(startUrl, extraHeaders = {}, maxRedirects = 15, logFn) {
    let currentUrl = startUrl;
    let res;
    for (let i = 0; i < maxRedirects; i++) {
      logFn?.("  → [" + (i + 1) + "] " + currentUrl.substring(0, 80));
      res = await this.getHtml(currentUrl, {
        ...(i === 0 ? { Referer: BASE + '/' } : { Referer: currentUrl }),
        ...extraHeaders
      });
      logFn?.("    ← " + res.status + " (cookies: " + this.jar.count() + ')');
      let location = res.headers?.['Location'] || res.headers?.['location'];
      if (Array.isArray(location)) location = location[0];
      if (res.status >= 300 && res.status < 400 && location && typeof location === 'string') {
        currentUrl = new URL(location, currentUrl).href;
      } else {
        break;
      }
    }
    return { ...res, finalUrl: currentUrl };
  }

  async close() {
    try { await this.tls.exit(); } catch {}
  }
}

async function runSignupViaAPI(proxyUrl, {
  email, password, name, birthdate, deviceId, sessionId,
  sentinelFn, otpFn, onStep, sharedCycleTLS
}) {
  const tls = await initCycleTLS();
  const session = new TLSSession(tls, proxyUrl);
  try {
    onStep?.("Init session");
    if (!session.jar.store.has('chatgpt.com')) {
      session.jar.store.set('chatgpt.com', new Map());
    }
    session.jar.store.get('chatgpt.com').set('oai-did', deviceId);

    const initRes = await session.getHtml(BASE + '/');
    if (initRes.status !== 200) {
      const cf = initRes.headers?.['Cf-Mitigated'] || initRes.headers?.['cf-mitigated'] || '';
      return {
        success: false,
        step: 'init',
        status: initRes.status,
        error: "Failed to reach chatgpt.com (HTTP " + initRes.status + (cf ? ", CF:" + cf : '') + ')'
      };
    }

    let activeDeviceId = deviceId;
    for (const [domain, jar] of session.jar.store) {
      if (domain.includes('chatgpt')) {
        const did = jar.get('oai-did');
        if (did) { activeDeviceId = did; break; }
      }
    }
    if (activeDeviceId !== deviceId) {
      for (const [domain, jar] of session.jar.store) {
        if (domain.includes('chatgpt') && jar.has('oai-did')) {
          jar.set('oai-did', activeDeviceId);
        }
      }
    }

    const csrfRes = await session.get(BASE + '/api/auth/csrf', {
      Referer: BASE + '/',
      'oai-device-id': activeDeviceId,
      'oai-language': 'en-US'
    });
    let csrfData;
    try { csrfData = await csrfRes.json(); } catch {}
    const csrfToken = csrfData?.csrfToken;
    if (!csrfToken) {
      return { success: false, step: 'csrf', status: csrfRes.status, error: "No CSRF token" };
    }
    onStep?.("CSRF ✓");

    const signinQuery = new URLSearchParams({
      prompt: 'login',
      'ext-oai-did': activeDeviceId,
      auth_session_logging_id: sessionId,
      screen_hint: 'login_or_signup',
      login_hint: email,
      'ext-passkey-client-capabilities': '0111'
    }).toString();
    const signinBody = new URLSearchParams({
      callbackUrl: BASE + '/',
      csrfToken,
      json: 'true'
    }).toString();

    const signinRes = await session.post(BASE + '/api/auth/signin/openai?' + signinQuery, signinBody, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE,
      Referer: BASE + '/',
      'oai-device-id': activeDeviceId,
      'oai-language': 'en-US'
    });
    let signinData;
    try { signinData = await signinRes.json(); } catch {}
    const authorizeUrl = signinData?.url;
    if (!authorizeUrl) {
      return { success: false, step: 'signin', status: signinRes.status, error: "No authorize URL" };
    }

    onStep?.('Authorize...');
    const authRes = await session.followRedirects(authorizeUrl, {}, 15);
    const finalUrl = authRes.finalUrl || '';
    if (!finalUrl.includes('/create-account') && !finalUrl.includes('/email-verification')) {
      if (finalUrl.includes('/log-in')) {
        return { success: false, step: 'authorize', error: "Email already registered (login page)" };
      }
    }
    onStep?.("Authorize ✓");

    const cookieList = [];
    let capturedDeviceId = null;
    for (const [domain, jar] of session.jar.store) {
      for (const [name, value] of jar) {
        cookieList.push({ name, value, domain });
        if (name === 'oai-did') capturedDeviceId = value;
      }
    }
    onStep?.('Sentinel...' + (capturedDeviceId !== activeDeviceId ? " ✗ oai-did MISMATCH!" : ''));

    let sentinelResult = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await sentinelFn?.('username_password_create', cookieList, tls);
        if (res && typeof res === 'object' && res.sentinelToken) {
          onStep?.("Sentinel ✓ (" + res.sentinelToken.length + 'ch)');
          sentinelResult = res;
          break;
        }
      } catch (err) {
        onStep?.("Sentinel attempt " + (attempt + 1) + ": " + err.message);
      }
    }
    if (!sentinelResult || !sentinelResult.sentinelToken) {
      return { success: false, step: 'register', status: 0, error: "Sentinel token not available — skipping register" };
    }

    const registerHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    if (sentinelResult && typeof sentinelResult === 'object') {
      if (sentinelResult.sentinelToken) registerHeaders['OpenAI-Sentinel-Token'] = sentinelResult.sentinelToken;
      if (sentinelResult.soToken) registerHeaders['OpenAI-Sentinel-SO-Token'] = sentinelResult.soToken;
    } else if (typeof sentinelResult === 'string') {
      registerHeaders['OpenAI-Sentinel-Token'] = sentinelResult;
    }

    const registerUrl = AUTH_BASE + '/api/accounts/user/register';
    const registerCookie = session.jar.headerFor(registerUrl);
    onStep?.('Register...');

    const registerOpts = {
      ja3: CHROME_JA3,
      http2Fingerprint: CHROME_H2,
      userAgent: CHROME_UA,
      timeout: 60,
      proxy: session.proxy,
      enableConnectionReuse: true,
      headers: {
        ...registerHeaders,
        ...(registerCookie ? { Cookie: registerCookie } : {}),
        Origin: AUTH_BASE,
        Referer: AUTH_BASE + '/create-account/password',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-ch-ua': CHROME_SEC_CH_UA,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      body: JSON.stringify({ password, username: email })
    };

    const registerRes = await session.tls(registerUrl, registerOpts, 'post');
    session.jar.capture(registerRes.headers, registerUrl);
    const registerStatus = registerRes.status;
    let registerData;
    try { registerData = await registerRes.json(); } catch {}
    if (!registerData) {
      try {
        const text = await registerRes.text();
        if (text) registerData = JSON.parse(text);
      } catch {}
    }

    if (registerStatus !== 200) {
      logger.warn("Email domain diblokir, mengganti dengan domain lain...");
      onStep?.("Register ✗ (" + registerStatus + "): domain blocked, switching domain");
      return { success: false, step: 'register', status: registerStatus, error: 'domain_blocked', domainBlocked: true };
    }
    onStep?.("Register ✓");

    await session.get(AUTH_BASE + '/api/accounts/email-otp/send', {
      Referer: AUTH_BASE + '/email-verification'
    });
    onStep?.("OTP: waiting...");

    const otp = await otpFn?.();
    if (!otp) return { success: false, step: 'otp', error: "OTP not received" };
    onStep?.("OTP ✓ (" + otp + ')');

    const otpRes = await session.post(AUTH_BASE + '/api/accounts/email-otp/validate', {
      code: otp.toString()
    }, {
      'Content-Type': 'application/json',
      Origin: AUTH_BASE,
      Referer: AUTH_BASE + '/email-verification',
      'sec-fetch-site': 'same-origin'
    });
    if (otpRes.status !== 200) {
      let otpData;
      try { otpData = await otpRes.json(); } catch {}
      return { success: false, step: 'otp_validate', status: otpRes.status, data: otpData };
    }

    onStep?.('Finalizing...');
    let finalSentinel = null;
    try {
      finalSentinel = await sentinelFn?.('oauth_create_account', null, tls);
    } catch {
      onStep?.("Sentinel (finalize): failed");
    }

    const createHeaders = {
      'Content-Type': 'application/json',
      Origin: AUTH_BASE,
      Referer: AUTH_BASE + '/about-you',
      'sec-fetch-site': 'same-origin'
    };
    if (finalSentinel && typeof finalSentinel === 'object') {
      if (finalSentinel.sentinelToken) createHeaders['OpenAI-Sentinel-Token'] = finalSentinel.sentinelToken;
      if (finalSentinel.soToken) createHeaders['OpenAI-Sentinel-SO-Token'] = finalSentinel.soToken;
    } else if (typeof finalSentinel === 'string') {
      createHeaders['OpenAI-Sentinel-Token'] = finalSentinel;
    }

    const createRes = await session.post(AUTH_BASE + '/api/accounts/create_account', {
      name,
      birthdate
    }, createHeaders);
    const createStatus = createRes.status;
    let createData;
    try { createData = await createRes.json(); } catch {}
    if (createStatus !== 200) {
      onStep?.("Finalize ✗ (" + createStatus + ')');
      return { success: false, step: 'create_account', status: createStatus, data: createData };
    }

    const continueUrl = createData?.continue_url;
    let accessToken = null;
    if (continueUrl) {
      const callbackUrl = continueUrl.startsWith('http') ? continueUrl : AUTH_BASE + continueUrl;
      onStep?.("OAuth callback...");
      await session.followRedirects(callbackUrl, {}, 15);
      onStep?.("OAuth ✓");

      const sessionRes = await session.get(BASE + '/api/auth/session', { Referer: BASE + '/' });
      let sessionData = null;
      if (sessionRes.data && typeof sessionRes.data === 'object' && !Buffer.isBuffer(sessionRes.data)) {
        sessionData = sessionRes.data;
      } else {
        try { sessionData = await sessionRes.json(); } catch {}
        if (!sessionData && sessionRes.data) {
          try {
            const raw = Buffer.isBuffer(sessionRes.data) ? sessionRes.data.toString('utf8') : String(sessionRes.data);
            sessionData = JSON.parse(raw);
          } catch {}
        }
      }
      accessToken = sessionData?.accessToken || null;
      if (!accessToken && sessionData) {
        logger.debug("Session keys: [" + Object.keys(sessionData).join(", ") + ']');
      }
    }

    onStep?.("Done ✓");
    return { success: true, accessToken };
  } finally {
    await session.close();
  }
}

async function runLoginViaAPI(proxyUrl, {
  email, password, deviceId, sessionId, otpFn, sentinelFn, onStep, sharedCycleTLS
}) {
  const ownsInstance = !sharedCycleTLS;
  const tls = sharedCycleTLS || (await initCycleTLS());
  const session = new TLSSession(tls, proxyUrl);
  try {
    onStep?.("Init session");
    const initRes = await session.getHtml(BASE + '/');
    if (initRes.status !== 200) {
      const cf = initRes.headers?.['Cf-Mitigated'] || initRes.headers?.['cf-mitigated'] || '';
      return { success: false, step: 'init', error: "Failed to reach chatgpt.com (HTTP " + initRes.status + (cf ? ", CF:" + cf : '') + ')' };
    }

    const csrfRes = await session.get(BASE + '/api/auth/csrf', { Referer: BASE + '/' });
    let csrfData;
    try { csrfData = await csrfRes.json(); } catch {}
    const csrfToken = csrfData?.csrfToken;
    if (!csrfToken) return { success: false, step: 'csrf', error: "No CSRF token" };
    onStep?.("CSRF ✓");

    const signinQuery = new URLSearchParams({
      prompt: 'login',
      'ext-oai-did': deviceId,
      auth_session_logging_id: sessionId,
      'ext-passkey-client-capabilities': '0111',
      screen_hint: 'login_or_signup',
      login_hint: email
    }).toString();
    const signinBody = new URLSearchParams({
      callbackUrl: BASE + '/',
      csrfToken,
      json: 'true'
    }).toString();

    const signinRes = await session.post(BASE + '/api/auth/signin/openai?' + signinQuery, signinBody, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE,
      Referer: BASE + '/'
    });
    let signinData;
    try { signinData = await signinRes.json(); } catch {}
    const authorizeUrl = signinData?.url;
    if (!authorizeUrl) {
      return { success: false, step: 'signin', status: signinRes.status, error: "No authorize URL" };
    }

    onStep?.('Authorize...');
    const authRes = await session.followRedirects(authorizeUrl, {}, 15);
    const finalUrl = authRes.finalUrl || '';

    const doOAuthCallback = async url => {
      const callbackUrl = url.startsWith('http') ? url : AUTH_BASE + url;
      return session.followRedirects(callbackUrl, {}, 15);
    };

    if (finalUrl.includes('chatgpt.com')) {
      onStep?.("Already logged in ✓");
    } else if (finalUrl.includes('/email-verification')) {
      onStep?.("Email verification...");
      const previousOtp = await otpFn?.();
      await session.get(AUTH_BASE + '/api/accounts/email-otp/send', {
        Referer: AUTH_BASE + '/email-verification'
      });
      onStep?.("OTP: waiting...");
      await new Promise(r => setTimeout(r, 10000));

      let otp = null;
      for (let i = 0; i < 10; i++) {
        const newOtp = await otpFn?.();
        if (newOtp && newOtp !== previousOtp) { otp = newOtp; break; }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!otp) return { success: false, step: 'otp', error: "OTP not received" };
      onStep?.("OTP ✓ (" + otp + ')');

      const otpRes = await session.post(AUTH_BASE + '/api/accounts/email-otp/validate', {
        code: otp.toString()
      }, {
        'Content-Type': 'application/json',
        Origin: AUTH_BASE,
        Referer: AUTH_BASE + '/email-verification'
      });
      let otpData;
      try { otpData = await otpRes.json(); } catch {}
      if (otpRes.status !== 200) {
        return { success: false, step: 'otp_validate', status: otpRes.status, data: otpData };
      }

      const continueUrl = otpData?.continue_url || '';
      onStep?.("OTP validated → " + (continueUrl.substring(0, 60) || "(empty body)"));

      if (continueUrl.includes('callback') || continueUrl.includes('code=')) {
        onStep?.("OAuth callback...");
        await doOAuthCallback(continueUrl);
        onStep?.("OAuth ✓");
      } else if (continueUrl.includes('/about-you')) {
        onStep?.("Profile incomplete, creating...");
        const createHeaders = {
          'Content-Type': 'application/json',
          Origin: AUTH_BASE,
          Referer: AUTH_BASE + '/about-you'
        };
        if (sentinelFn) {
          try {
            const sentinel = await sentinelFn('oauth_create_account');
            if (sentinel && typeof sentinel === 'object') {
              if (sentinel.sentinelToken) createHeaders['OpenAI-Sentinel-Token'] = sentinel.sentinelToken;
              if (sentinel.soToken) createHeaders['OpenAI-Sentinel-SO-Token'] = sentinel.soToken;
            } else if (typeof sentinel === 'string') {
              createHeaders['OpenAI-Sentinel-Token'] = sentinel;
            }
          } catch (err) {
            onStep?.("Sentinel ✗ (" + err.message + ')');
          }
        }

        const fallbackName = email.split('@')[0].replace(/[^a-zA-Z\s]/g, '') || 'User';
        const createRes = await session.post(AUTH_BASE + '/api/accounts/create_account', {
          name: fallbackName,
          birthdate: '1995-06-15'
        }, createHeaders);
        let createData;
        try { createData = await createRes.json(); } catch {}

        if (createRes.status === 200 && createData?.continue_url) {
          onStep?.("Profile ✓");
          const oauthRes = await doOAuthCallback(createData.continue_url);
          if (!oauthRes.finalUrl?.includes('chatgpt.com')) {
            onStep?.('Re-authorize...');
            const reAuthRes = await session.followRedirects(authorizeUrl, {}, 15);
            if (!reAuthRes.finalUrl?.includes('chatgpt.com')) {
              return { success: false, step: 'create_account_oauth', error: "Ended on: " + reAuthRes.finalUrl?.substring(0, 100) };
            }
          }
          onStep?.("OAuth ✓");
        } else {
          onStep?.("Profile ✗ (" + createRes.status + ": " + JSON.stringify(createData).substring(0, 100) + ')');
          return { success: false, step: 'create_account', status: createRes.status, data: createData };
        }
      } else {
        onStep?.("Re-authorize (original URL)...");
        const reAuthRes = await session.followRedirects(authorizeUrl, {}, 15);
        const reAuthUrl = reAuthRes.finalUrl || '';
        if (reAuthUrl.includes('chatgpt.com')) {
          onStep?.("OAuth ✓");
        } else {
          onStep?.("Re-auth → " + reAuthUrl.substring(0, 60));
          return { success: false, step: 'reauthorize', error: "Ended on: " + reAuthUrl.substring(0, 100) };
        }
      }
    } else if (finalUrl.includes('/log-in') || finalUrl.includes('/password')) {
      onStep?.('Password...');
      const pwRes = await session.post(AUTH_BASE + '/api/accounts/password/verify', {
        password
      }, {
        'Content-Type': 'application/json',
        Origin: AUTH_BASE,
        Referer: AUTH_BASE + '/log-in/password'
      });
      let pwData;
      try { pwData = await pwRes.json(); } catch {}
      if (pwRes.status !== 200) {
        onStep?.("Password ✗ (" + pwRes.status + ')');
        return { success: false, step: 'password', status: pwRes.status, data: pwData };
      }
      onStep?.("Password ✓");
      if (pwData?.continue_url) {
        const oauthRes = await doOAuthCallback(pwData.continue_url);
        if (!oauthRes.finalUrl?.includes('chatgpt.com')) {
          return { success: false, step: 'password_oauth', error: "Ended on: " + oauthRes.finalUrl?.substring(0, 80) };
        }
        onStep?.("OAuth ✓");
      }
    } else {
      return { success: false, step: 'authorize', error: "Unexpected page: " + finalUrl.substring(0, 80) };
    }

    onStep?.('Token...');
    let accessToken = null;
    for (let i = 0; i < 3; i++) {
      const sessionRes = await session.get(BASE + '/api/auth/session', { Referer: BASE + '/' });
      let sessionData = null;
      if (sessionRes.data && typeof sessionRes.data === 'object' && !Buffer.isBuffer(sessionRes.data)) {
        sessionData = sessionRes.data;
      } else {
        try { sessionData = await sessionRes.json(); } catch {}
        if (!sessionData && sessionRes.data) {
          try {
            const raw = Buffer.isBuffer(sessionRes.data) ? sessionRes.data.toString('utf8') : String(sessionRes.data);
            sessionData = JSON.parse(raw);
          } catch {}
        }
      }
      if (sessionData?.accessToken) {
        accessToken = sessionData.accessToken;
        break;
      }
    }

    if (!accessToken) {
      onStep?.("Token ✗");
      return { success: false, step: 'token', error: "Access token not found" };
    }
    onStep?.("Token ✓");
    return { success: true, accessToken, cookieJar: session.jar };
  } finally {
    if (ownsInstance) await session.close();
  }
}

module.exports = { runSignupViaAPI, runLoginViaAPI };
