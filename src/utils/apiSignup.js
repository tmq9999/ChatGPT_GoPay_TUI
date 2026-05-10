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
    for (let _r = 0; _r < 3; _r++) {
      try {
        const res = await this.tls(url, opts, 'get');
        this.jar.capture(res.headers, res.finalUrl || url);
        if (res.status === 0 && _r < 2) {
          try { this.tls = await initCycleTLS(); } catch {}
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return res;
      } catch (e) {
        if (_r < 2 && (e.message?.includes('toLowerCase') || e.message?.includes('ECONNRESET'))) {
          try { this.tls = await initCycleTLS(); } catch {}
          continue;
        }
        throw e;
      }
    }
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
    for (let _r = 0; _r < 3; _r++) {
      try {
        const res = await this.tls(url, opts, 'get');
        this.jar.capture(res.headers, res.finalUrl || url);
        if (res.status === 0 && _r < 2) {
          try { this.tls = await initCycleTLS(); } catch {}
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return res;
      } catch (e) {
        if (_r < 2 && (e.message?.includes('toLowerCase') || e.message?.includes('ECONNRESET'))) {
          try { this.tls = await initCycleTLS(); } catch {}
          continue;
        }
        throw e;
      }
    }
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
    for (let _r = 0; _r < 3; _r++) {
      try {
        const res = await this.tls(url, opts, 'post');
        this.jar.capture(res.headers, res.finalUrl || url);
        if (res.status === 0 && _r < 2) {
          try { this.tls = await initCycleTLS(); } catch {}
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return res;
      } catch (e) {
        if (_r < 2 && (e.message?.includes('toLowerCase') || e.message?.includes('ECONNRESET'))) {
          try { this.tls = await initCycleTLS(); } catch {}
          continue;
        }
        throw e;
      }
    }
  }

  async followRedirects(startUrl, extraHeaders = {}, maxRedirects = 15) {
    let currentUrl = startUrl;
    let res;
    for (let i = 0; i < maxRedirects; i++) {
      res = await this.getHtml(currentUrl, {
        ...(i === 0 ? { Referer: BASE + '/' } : { Referer: currentUrl }),
        ...extraHeaders
      });
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

/** Parse CycleTLS response body — CycleTLS has no .json(), data is already parsed or a string */
function _parseBody(res) {
  if (res.data && typeof res.data === 'object' && !Buffer.isBuffer(res.data)) return res.data;
  if (res.data) {
    try { return JSON.parse(Buffer.isBuffer(res.data) ? res.data.toString('utf8') : String(res.data)); } catch {}
  }
  return null;
}

async function runSignupViaAPI(proxyUrl, {
  email, password, name, birthdate, deviceId, sessionId,
  sentinelFn, otpFn, onStep, sharedCycleTLS
}) {
  const tls = sharedCycleTLS || await initCycleTLS();
  const _ownTls = !sharedCycleTLS; // track if we created it (need to cleanup)
  const session = new TLSSession(tls, proxyUrl);
  try {
    // ─── STEP 1: Init chatgpt.com ───
    if (!session.jar.store.has('chatgpt.com')) {
      session.jar.store.set('chatgpt.com', new Map());
    }
    session.jar.store.get('chatgpt.com').set('oai-did', deviceId);

    const initRes = await session.getHtml(BASE + '/');
    if (initRes.status !== 200) {
      const cf = initRes.headers?.['Cf-Mitigated'] || initRes.headers?.['cf-mitigated'] || '';
      return { success: false, step: 'init', status: initRes.status, error: "Failed to reach chatgpt.com (HTTP " + initRes.status + (cf ? ", CF:" + cf : '') + ')' };
    }

    let activeDeviceId = deviceId;
    for (const [domain, jar] of session.jar.store) {
      if (domain.includes('chatgpt')) {
        const did = jar.get('oai-did');
        if (did) { activeDeviceId = did; break; }
      }
    }

    // ─── STEP 2: CSRF ───
    const csrfRes = await session.get(BASE + '/api/auth/csrf', {
      Referer: BASE + '/',
      'oai-device-id': activeDeviceId,
      'oai-language': 'en-US'
    });
    const csrfData = _parseBody(csrfRes);
    const csrfToken = csrfData?.csrfToken;
    if (!csrfToken) {
      return { success: false, step: 'csrf', status: csrfRes.status, error: "No CSRF token" };
    }


    // ─── STEP 3: Signin → get authorize URL ───
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
    const signinData = _parseBody(signinRes);
    const authorizeUrl = signinData?.url;
    if (!authorizeUrl) {
      return { success: false, step: 'signin', status: signinRes.status, error: "No authorize URL" };
    }

    // ─── STEP 4: Follow redirects → /email-verification ───
    onStep?.("[1/7] 🌐 Khởi tạo phiên...");
    const authRes = await Promise.race([
      session.followRedirects(authorizeUrl, {}, 15),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Auth redirect timeout (10s)')), 10000))
    ]);
    const finalUrl = authRes.finalUrl || '';
    if (finalUrl.includes('/log-in')) {
      return { success: false, step: 'authorize', error: "Email already registered (login page)" };
    }
    if (!finalUrl.includes('/email-verification') && !finalUrl.includes('/create-account')) {
      return { success: false, step: 'authorize', error: "Unexpected page: " + finalUrl.substring(0, 100) };
    }


    // ─── STEP 5: OTP — wait for email then validate ───
    // OpenAI sends OTP automatically when landing on /email-verification
    const otp = await otpFn?.();
    if (!otp) return { success: false, step: 'otp', error: "OTP not received" };
    onStep?.("[2/7] 📧 OTP: " + otp);

    const otpRes = await session.post(AUTH_BASE + '/api/accounts/email-otp/validate', {
      code: otp.toString()
    }, {
      'Content-Type': 'application/json',
      Origin: AUTH_BASE,
      Referer: AUTH_BASE + '/email-verification',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin'
    });
    if (otpRes.status !== 200) {
      const otpData = _parseBody(otpRes);
      const errDetail = otpData?.error?.message || otpData?.detail || otpData?.message || ('HTTP ' + otpRes.status);
      return { success: false, step: 'otp_validate', status: otpRes.status, error: 'otp_validate: ' + errDetail, data: otpData };
    }
    onStep?.("[2/7] ✅ Xác thực OTP thành công");

    // ─── STEP 6: client_auth_session_dump ───
    await session.get(AUTH_BASE + '/api/accounts/client_auth_session_dump', {
      Referer: AUTH_BASE + '/email-verification'
    });

    // ─── STEP 7: Sentinel for create_account (BEFORE password per browser trace) ───
    let createSentinel = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await sentinelFn?.('oauth_create_account', null, tls);
        if (res && typeof res === 'object' && res.sentinelToken) {
          createSentinel = res;
          break;
        }
      } catch (err) {

      }
    }

    // ─── STEP 8: Create account (name + birthdate) — BEFORE password ───

    const createHeaders = {
      'Content-Type': 'application/json', Origin: AUTH_BASE,
      Referer: AUTH_BASE + '/about-you',
      'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin'
    };
    if (createSentinel && typeof createSentinel === 'object') {
      if (createSentinel.sentinelToken) createHeaders['OpenAI-Sentinel-Token'] = createSentinel.sentinelToken;
      if (createSentinel.soToken) createHeaders['OpenAI-Sentinel-SO-Token'] = createSentinel.soToken;
    }

    const createRes = await session.post(AUTH_BASE + '/api/accounts/create_account', { name, birthdate }, createHeaders);
    const createData = _parseBody(createRes);
    if (createRes.status !== 200) {
      const errMsg = createData?.error?.message || createData?.detail || createData?.message || createData?.error?.code || '';
      onStep?.("[3/7] ❌ Tạo tài khoản thất bại (" + createRes.status + ") " + errMsg);
      return { success: false, step: 'create_account', status: createRes.status, error: 'create_account: ' + (errMsg || 'HTTP ' + createRes.status), data: createData };
    }
    onStep?.("[3/7] ✅ Tạo tài khoản thành công");

    // ─── STEP 9: OAuth callback → session token ───
    const continueUrl = createData?.continue_url;
    let accessToken = null;
    let sessionData = null;
    if (continueUrl) {
      const callbackUrl = continueUrl.startsWith('http') ? continueUrl : AUTH_BASE + continueUrl;
      await session.followRedirects(callbackUrl, {}, 15);
    }

    const sessionRes = await session.get(BASE + '/api/auth/session', { Referer: BASE + '/' });
    sessionData = _parseBody(sessionRes);
    accessToken = sessionData?.accessToken || null;
    let sessionToken = sessionData?.sessionToken || '';
    if (!accessToken) {
      onStep?.("[4/7] ❌ Không lấy được Session Token");
      return { success: false, step: 'session', error: 'No access token after OAuth' };
    }
    onStep?.("[4/7] ✅ Lấy Session Token thành công");

    // ─── STEP 10: Add Password (post-login, per browser trace) ───

    // 10a: Get fresh CSRF for the password signin
    const csrf2Res = await session.get(BASE + '/api/auth/csrf', { Referer: BASE + '/' });
    const csrf2Data = _parseBody(csrf2Res);
    const csrf2Token = csrf2Data?.csrfToken;

    if (csrf2Token) {
      // 10b: POST signin with post_login_add_password=true
      const pwSigninQuery = new URLSearchParams({
        connection: 'password',
        login_hint: email,
        reauth: 'password',
        post_login_add_password: 'true',
        max_age: '0',
        'ext-oai-did': activeDeviceId,
      }).toString();
      const pwSigninBody = new URLSearchParams({
        callbackUrl: BASE + '/',
        csrfToken: csrf2Token,
        json: 'true'
      }).toString();

      const pwSigninRes = await session.post(BASE + '/api/auth/signin/openai?' + pwSigninQuery, pwSigninBody, {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: BASE, Referer: BASE + '/',
      });
      const pwSigninData = _parseBody(pwSigninRes);
      const pwAuthUrl = pwSigninData?.url;

      if (pwAuthUrl) {
        const pwAuthRes = await session.followRedirects(pwAuthUrl, {}, 15);
        const pwFinalUrl = pwAuthRes.finalUrl || '';

        // client_auth_session_dump (establishes auth session)
        await session.get(AUTH_BASE + '/api/accounts/client_auth_session_dump', {
          Referer: AUTH_BASE + '/email-verification'
        });

        if (pwFinalUrl.includes('/email-verification')) {
          const otp2 = await otpFn?.();
          if (otp2) {
            const otp2Res = await session.post(AUTH_BASE + '/api/accounts/email-otp/validate', {
              code: otp2.toString()
            }, {
              'Content-Type': 'application/json', Origin: AUTH_BASE,
              Referer: AUTH_BASE + '/email-verification',
            });
            const otp2Data = _parseBody(otp2Res);

            if (otp2Res.status === 200) {
              onStep?.("[5/7] 📧 OTP2: " + otp2 + " → ✅");
              if (otp2Data?.continue_url) {
                await session.followRedirects(
                  otp2Data.continue_url.startsWith('http') ? otp2Data.continue_url : AUTH_BASE + otp2Data.continue_url,
                  {}, 15
                );
              }
            } else {
              const errMsg = otp2Data?.error?.message || otp2Data?.detail || ('HTTP ' + otp2Res.status);
              onStep?.("[5/7] ❌ OTP2: " + otp2 + " → " + errMsg);
            }
          } else {
            onStep?.("[5/7] ⚠️ Không lấy được OTP2");
          }
        } else if (pwFinalUrl.includes('/reset-password') || pwFinalUrl.includes('/new-password')) {
          // Skip OTP2 — already on password page
        } else {
          onStep?.("[5/7] ⚠️ Redirect lạ: " + pwFinalUrl.substring(0, 80));
        }

        // 10f: client_auth_session_dump (again, after OTP2 for password page)
        await session.get(AUTH_BASE + '/api/accounts/client_auth_session_dump', {
          Referer: AUTH_BASE + '/reset-password/new-password'
        });

        // 10f: Sentinel for password_reset flow
        let pwSentinel = null;
        try {
          pwSentinel = await sentinelFn?.('password_reset', null, tls);
        } catch {}

        // 10g: POST /api/accounts/password/add (NOT /user/register)
        const addPwUrl = AUTH_BASE + '/api/accounts/password/add';
        const addPwHeaders = { Accept: 'application/json', 'Content-Type': 'application/json' };
        if (pwSentinel?.sentinelToken) addPwHeaders['openai-sentinel-token'] = pwSentinel.sentinelToken;
        if (pwSentinel?.soToken) addPwHeaders['OpenAI-Sentinel-SO-Token'] = pwSentinel.soToken;

        const addPwOpts = {
          ja3: CHROME_JA3, http2Fingerprint: CHROME_H2, userAgent: CHROME_UA,
          timeout: 30, proxy: session.proxy, disableRedirect: true,
          headers: {
            ...addPwHeaders,
            ...(session.jar.headerFor(addPwUrl) ? { Cookie: session.jar.headerFor(addPwUrl) } : {}),
            Origin: AUTH_BASE, Referer: AUTH_BASE + '/reset-password/new-password',
            'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin',
            'sec-ch-ua': CHROME_SEC_CH_UA, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          body: JSON.stringify({ password })
        };

        let addPwRes = null;
        for (let pwAttempt = 0; pwAttempt < 3; pwAttempt++) {
          addPwRes = await session.tls(addPwUrl, addPwOpts, 'post');
          session.jar.capture(addPwRes.headers, addPwUrl);
          if (addPwRes.status === 200 || (addPwRes.status > 0 && addPwRes.status < 500)) break;
          // status 0 = network error, retry
          if (pwAttempt < 2) await new Promise(r => setTimeout(r, 2000));
        }

        if (addPwRes.status === 200) {
          onStep?.("[5/7] ✅ Mật khẩu OK");

          // Follow continue_url from password response back to chatgpt.com
          const addPwData = _parseBody(addPwRes);
          if (addPwData?.continue_url) {
            const contUrl = addPwData.continue_url.startsWith('http')
              ? addPwData.continue_url : AUTH_BASE + addPwData.continue_url;
            await session.followRedirects(contUrl, {}, 15);
          }

          // Re-establish chatgpt.com session
          const callbackRes = await session.get(BASE + '/api/auth/session', { Referer: BASE + '/' });
          const sess2Data = _parseBody(callbackRes);
          if (sess2Data?.accessToken) {
            accessToken = sess2Data.accessToken;
            sessionData = sess2Data;
          }
        } else {
          const addPwData = _parseBody(addPwRes);
          const errMsg = addPwData?.error?.message || addPwData?.detail || 'status ' + addPwRes.status;
          onStep?.("[5/7] ❌ Đặt mật khẩu thất bại: " + errMsg);
        }
      } else {
        onStep?.("[5/7] ⚠️ Bỏ qua đặt mật khẩu (không có redirect)");
      }
    } else {
      onStep?.("[5/7] ⚠️ Bỏ qua đặt mật khẩu (không có CSRF)");
    }


    return { success: true, accessToken, sessionData, sessionToken: sessionData?.sessionToken || sessionToken };
  } finally {
    if (_ownTls) await session.close();
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
    const csrfData = _parseBody(csrfRes);
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
    const signinData = _parseBody(signinRes);
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
      const otpData = _parseBody(otpRes);
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
        const createData = _parseBody(createRes);

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
      const pwData = _parseBody(pwRes);
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
      const sessionData = _parseBody(sessionRes);
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
    return { success: true, accessToken, sessionData, cookieJar: session.jar };
  } finally {
    if (ownsInstance) await session.close();
  }
}

module.exports = { runSignupViaAPI, runLoginViaAPI };
