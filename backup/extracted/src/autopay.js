const {
  v4: uuidv4
} = require('uuid');
const {
  createClient
} = require('./utils/httpClient');
const {
  fetchOtpWithRetry,
  fetchOtpTmailCandidates,
  fetchOtpGeneratorCandidates
} = require('./utils/otpFetcher');
const {
  generateSentinelTokens
} = require('./utils/sentinelToken');
const {
  unlinkOpenAIFromGoPay
} = require('./utils/gopayUnlink');
const initCycleTLS = require('cycletls');
const logger = require('./utils/logger');
const readline = require('readline');

const CHROME_JA3 = '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
const CHROME_H2 = '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const CHROME_SEC_CH_UA = '"Chromium";v="137", "Not/A)Brand";v="24", "Google Chrome";v="137"';
const BASE_CHATGPT = 'https://chatgpt.com';
const BASE_AUTH = 'https://auth.openai.com';
const STRIPE_API = 'https://api.stripe.com';
const MIDTRANS_API = 'https://app.midtrans.com';
const GOPAY_MERCHANTS_APP = 'https://merchants-gws-app.gopayapi.com';
const GOPAY_GWA_API = 'https://gwa.gopayapi.com';
const GOPAY_CUSTOMER_API = 'https://customer.gopayapi.com';
const GOPAY_PIN_CLIENT_ID = '51b5f09a-3813-11ee-be56-0242ac120002-MGUPA';
const STRIPE_PK = 'pk_live_51HOrSwC6h1nxGoI3lTAgRjYVrz4dU3fVOabyCcKR3pbEJguCVAlqCxdxCUvoRh1XWwRacViovU3kLKvpkjh7IqkW00iXQsjo3n';
const STRIPE_VERSION = '2025-03-31.basil; checkout_server_update_beta=v1; checkout_manual_approval_preview=v1';

const INDONESIA_CITIES = [{
  'city': "Jakarta Pusat",
  'state': "DKI Jakarta",
  'postalBase': 0x65
}, {
  'city': "Jakarta Selatan",
  'state': "DKI Jakarta",
  'postalBase': 0x79
}, {
  'city': "Jakarta Barat",
  'state': "DKI Jakarta",
  'postalBase': 0x72
}, {
  'city': "Jakarta Timur",
  'state': "DKI Jakarta",
  'postalBase': 0x82
}, {
  'city': 'Surabaya',
  'state': "East Java",
  'postalBase': 0x259
}, {
  'city': 'Bandung',
  'state': "West Java",
  'postalBase': 0x191
}, {
  'city': 'Medan',
  'state': "North Sumatra",
  'postalBase': 0xc9
}, {
  'city': 'Semarang',
  'state': "Central Java",
  'postalBase': 0x1f5
}, {
  'city': 'Makassar',
  'state': "South Sulawesi",
  'postalBase': 0x385
}, {
  'city': 'Palembang',
  'state': "South Sumatra",
  'postalBase': 0x12d
}, {
  'city': 'Denpasar',
  'state': 'Bali',
  'postalBase': 0x321
}, {
  'city': 'Yogyakarta',
  'state': "DI Yogyakarta",
  'postalBase': 0x227
}, {
  'city': 'Malang',
  'state': "East Java",
  'postalBase': 0x28b
}, {
  'city': 'Bogor',
  'state': "West Java",
  'postalBase': 0xa1
}, {
  'city': 'Tangerang',
  'state': 'Banten',
  'postalBase': 0x97
}, {
  'city': 'Depok',
  'state': "West Java",
  'postalBase': 0xa4
}, {
  'city': 'Bekasi',
  'state': "West Java",
  'postalBase': 0xab
}, {
  'city': 'Solo',
  'state': "Central Java",
  'postalBase': 0x23b
}, {
  'city': 'Balikpapan',
  'state': "East Kalimantan",
  'postalBase': 0x2f9
}, {
  'city': 'Manado',
  'state': "North Sulawesi",
  'postalBase': 0x3b7
}];

const STREET_NAMES = ["Jl. Merdeka", "Jl. Sudirman", "Jl. Thamrin", "Jl. Gatot Subroto", "Jl. Ahmad Yani", "Jl. Diponegoro", "Jl. Imam Bonjol", "Jl. Hayam Wuruk", "Jl. Gajah Mada", "Jl. Pemuda", "Jl. Pahlawan", "Jl. Veteran", "Jl. Kartini", "Jl. Pattimura", "Jl. Cendrawasih", "Jl. Mawar", "Jl. Melati", "Jl. Kenanga", "Jl. Anggrek", "Jl. Dahlia", "Jl. Mangga", "Jl. Rambutan", "Jl. Durian", "Jl. Kelapa", "Jl. Kebon Jeruk", "Jl. Tebet Raya", "Jl. Raya Bogor", "Jl. Raya Serpong", "Jl. Sisingamangaraja", "Jl. Pangeran Antasari", "Jl. Wolter Monginsidi", "Jl. Letjen S. Parman"];
const KOMPLEK_NAMES = ["Perumahan Griya Indah", "Komplek Taman Sari", "Perumahan Bumi Asri", "Green Residence", "Grand Mansion", "Taman Permata", "Villa Bukit Mas", "Puri Kencana", "Graha Sentosa", "Citra Garden"];
const FIRST_NAMES = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fitri', 'Gunawan', 'Hendra', 'Irfan', 'Joko', 'Kartika', 'Lina', 'Mega', 'Nadia', 'Putri', 'Rizki', 'Sari', 'Tono', 'Udin', 'Wati', 'Yusuf', 'Zahra', 'Agus', 'Bambang', 'Dian', 'Fajar', 'Gilang', 'Hani', 'Indra', 'Kurnia'];
const LAST_NAMES = ['Pratama', 'Saputra', 'Nugraha', 'Permana', 'Hidayat', 'Wijaya', 'Santoso', 'Purnomo', 'Wibowo', 'Kusuma', 'Setiawan', 'Rahayu', 'Susanto', 'Handoko', 'Hartono', 'Darmawan', 'Suryadi', 'Lestari', 'Suharto', 'Mulyadi'];

function randomItem(a) {
  return a[Math.floor(Math.random() * a.length)];
}
function randomInt(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
function generateRandomName() {
  return randomItem(FIRST_NAMES) + ' ' + randomItem(LAST_NAMES);
}
function generateBillingAddress(a) {
  const b = randomItem(INDONESIA_CITIES);
  const c = String(b.postalBase) + String(randomInt(10, 99));
  const d = randomItem(STREET_NAMES);
  const e = randomInt(1, 250);
  const f = String(randomInt(1, 20)).padStart(2, '0');
  const g = String(randomInt(1, 15)).padStart(2, '0');
  const h = [
    d + ' No.' + e + ' RT' + f + '/RW' + g,
    d + ' No.' + e,
    d + ' No.' + e + ', Blok ' + String.fromCharCode(0x41 + randomInt(0, 7)) + randomInt(1, 30),
    randomItem(KOMPLEK_NAMES) + ', ' + d + ' No.' + e,
    d + ' No.' + e + ' RT' + f + '/RW' + g + ', Kel. ' + b.city
  ];
  const i = Math.random() > 0.3 ? generateRandomName() : a;
  return {
    'name': i,
    'country': 'ID',
    'line1': randomItem(h),
    'city': b.city,
    'state': b.state,
    'postal_code': c
  };
}
function getUserInput(a) {
  const b = readline.createInterface({
    'input': process.stdin,
    'output': process.stdout
  });
  return new Promise(c => b.question(a, d => {
    b.close();
    c(d.trim());
  }));
}
function sleep(a) {
  return new Promise(b => setTimeout(b, a));
}

class LoginCookieJar {
  constructor() {
    this.store = new Map();
  }
  ['capture'](a, b) {
    if (!b || typeof b !== 'string') return;
    let c;
    try {
      c = new URL(b).hostname;
    } catch {
      return;
    }
    const d = a?.['Set-Cookie'] || a?.['set-cookie'];
    if (!d) return;
    const e = Array.isArray(d) ? d : [d];
    for (const f of e) {
      if (typeof f !== 'string') continue;
      const g = f.match(/^([^=]+)=([^;]*)/);
      if (!g) continue;
      const h = g[1].trim();
      const i = g[2];
      const j = f.match(/[;]\s*[Dd]omain=\.?([^;,\s]+)/i);
      const k = j ? j[1].toLowerCase() : c;
      if (!this.store.has(k)) this.store.set(k, new Map());
      this.store.get(k).set(h, i);
    }
  }
  ['headerFor'](a) {
    const b = new URL(a).hostname;
    const c = [];
    for (const [d, e] of this.store) {
      if (b === d || b.endsWith('.' + d) || d.endsWith('.' + b) || b.includes(d)) {
        for (const [f, g] of e) c.push(f + '=' + g);
      }
    }
    return c.length ? c.join('; ') : undefined;
  }
  ['get'](a, b) {
    const c = this.store.get(a);
    return c ? c.get(b) : undefined;
  }
  ['allCookieNames']() {
    const a = [];
    for (const [b, c] of this.store) {
      for (const [d] of c) a.push(b + ':' + d);
    }
    return a;
  }
}

class ChatGPTAutopay {
  constructor(a) {
    this.email = a.email;
    this.password = a.password;
    this.name = a.name;
    this.deviceId = a.deviceId || uuidv4();
    this.sessionId = uuidv4();
    this.stripeJsId = uuidv4();
    // FIX 1: restored \x1b ANSI escape codes
    this.tag = a.threadId ? '\x1b[36m[#' + a.threadId + ']\x1b[0m ' : '';
    this.clientId = a.clientId || 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH';
    this.redirectUri = a.redirectUri || 'https://chatgpt.com/api/auth/callback/openai';
    this.audience = a.audience || 'https://api.openai.com/v1';
    this.otpConfig = {
      'provider': a.webmailProvider || 'tmail',
      'serviceDomain': a.emailServiceDomain,
      'apiKey': a.emailServiceApiKey,
      'geDomain': a.geDomain || 'generator.email',
      'akbarMailboxId': a.akbarMailboxId || null,
    };
    this.gopayPhone = a.gopayPhone;
    this.gopayPin = a.gopayPin;
    this.skipOtp = a.skipOtp || false;
    this.skipLogin = a.skipLogin || false;
    this.proxyUrl = a.proxyUrl || null;
    this.loginProxyUrl = a.loginProxyUrl !== undefined ? a.loginProxyUrl : this.proxyUrl;
    this.checkoutProxyUrl = a.checkoutProxyUrl !== undefined ? a.checkoutProxyUrl : this.proxyUrl;
    this.sharedCycleTLS = a.sharedCycleTLS || null;
    this._otpInputFn = a.otpInputFn || null;
    this.adbPath = a.otpModeConfig?.['adbPath'] || null;
    this.deviceSerial = a.otpModeConfig?.['deviceSerial'] || null;
    const { client: b, jar: c } = createClient(this.proxyUrl);
    this.client = b;
    this.jar = c;
    if (this.loginProxyUrl !== this.proxyUrl) {
      const { client: h, jar: i } = createClient(this.loginProxyUrl);
      this.loginClient = h;
      this.loginJar = i;
    } else {
      this.loginClient = this.client;
      this.loginJar = this.jar;
    }
    const { client: d, jar: e } = createClient(null);
    this.stripeClient = d;
    this.stripeJar = e;
    const { client: f, jar: g } = createClient(null, 0xafc8);
    this.midtransClient = f;
    this.midtransJar = g;
    this.checkoutSessionId = null;
    this.publishableKey = null;
    this.paymentMethodId = null;
    this.midtransSnapId = null;
    this.gopayReference = null;
    this.stripeReturnNonce = null;
    this.accessToken = a.accessToken || null;
    this.buildNumber = '6299018';
    this.clientVersion = 'prod-0bc978e2de2d5c897deef898197331ee062619cf';
    this._cycleTLS = null;
    this._oaiJar = null;
    this._gopayLinked = false;
    this._pastStripe = false;
  }

  ['_oaiHeaders']() {
    const a = {
      'Content-Type': 'application/json',
      'oai-device-id': this.deviceId,
      'oai-session-id': this.sessionId,
      'oai-client-build-number': this.buildNumber,
      'oai-client-version': this.clientVersion,
      'oai-language': 'en-US',
      'Origin': BASE_CHATGPT,
      'Referer': BASE_CHATGPT + '/'
    };
    if (this.accessToken) {
      a.Authorization = 'Bearer ' + this.accessToken;
    }
    return a;
  }

  ['_parseBody'](a) {
    if (typeof a === 'object') return a;
    try {
      return JSON.parse(a);
    } catch {
      return a;
    }
  }

  ['_sanitizeHeaders'](a) {
    const b = {};
    for (const [c, d] of Object.entries(a)) {
      if (d == null) continue;
      b[c] = Array.isArray(d) ? d[0] : String(d);
    }
    return b;
  }

  ['_cycleTlsOpts'](a, b = {}, c = null) {
    const d = this._oaiJar?.['headerFor'](a);
    return {
      'ja3': CHROME_JA3,
      'http2Fingerprint': CHROME_H2,
      'userAgent': CHROME_UA,
      'timeout': 0x3c,
      'proxy': c || this.proxyUrl || undefined,
      'disableRedirect': true,
      'enableConnectionReuse': true,
      'headers': this._sanitizeHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': CHROME_SEC_CH_UA,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        ...(d ? { 'Cookie': d } : {}),
        ...b
      })
    };
  }

  async ['_oaiGet'](a, b = {}, c = null) {
    const d = this._cycleTlsOpts(a, {
      'Accept': 'application/json',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...this._oaiHeaders(),
      ...b
    }, c);
    for (let f = 0; f < 2; f++) {
      try {
        const g = await this._cycleTLS(a, d, 'get');
        this._oaiJar.capture(g.headers, g.finalUrl || a);
        return { 'status': g.status, 'data': this._parseBody(g.data), 'headers': g.headers };
      } catch (h) {
        if (f === 0 && h.message?.includes('toLowerCase')) {
          logger.warn(this.tag + 'CycleTLS reinit...');
          try { this._cycleTLS = await initCycleTLS(); } catch {}
          continue;
        }
        throw h;
      }
    }
  }

  async ['_oaiPost'](a, b, c = {}, d = null) {
    const f = this._cycleTlsOpts(a, {
      'Accept': 'application/json',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...this._oaiHeaders(),
      ...c
    }, d);
    f.body = typeof b === 'string' ? b : JSON.stringify(b);
    for (let g = 0; g < 2; g++) {
      try {
        const h = await this._cycleTLS(a, f, 'post');
        this._oaiJar.capture(h.headers, h.finalUrl || a);
        return { 'status': h.status, 'data': this._parseBody(h.data), 'headers': h.headers };
      } catch (i) {
        if (g === 0 && i.message?.includes('toLowerCase')) {
          logger.warn(this.tag + 'CycleTLS reinit...');
          try { this._cycleTLS = await initCycleTLS(); } catch {}
          continue;
        }
        throw i;
      }
    }
  }

  async ['_oaiGetHtml'](a, b = {}) {
    const c = this._cycleTlsOpts(a, {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      ...b
    });
    for (let d = 0; d < 2; d++) {
      try {
        const f = await this._cycleTLS(a, c, 'get');
        this._oaiJar.capture(f.headers, f.finalUrl || a);
        return { 'status': f.status, 'data': f.data, 'headers': f.headers };
      } catch (g) {
        if (d === 0 && g.message?.includes('toLowerCase')) {
          logger.warn(this.tag + 'CycleTLS reinit...');
          try { this._cycleTLS = await initCycleTLS(); } catch {}
          continue;
        }
        throw g;
      }
    }
  }

  async ['cleanup']() {
    if (this._cycleTLS && !this.sharedCycleTLS) {
      try { await this._cycleTLS.exit(); } catch {}
    }
  }

  ['_midtransHeaders']() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-source': 'snap',
      'x-source-app-type': 'redirection',
      'x-source-version': '2.3.0',
      'x-request-id': uuidv4(),
      'Origin': MIDTRANS_API
    };
  }

  async ['loginToChatGPT']() {
    this._cycleTLS = this.sharedCycleTLS || (await initCycleTLS());
    const a = this.loginProxyUrl || this.proxyUrl || '';
    this._oaiJar = new LoginCookieJar();
    const b = this._oaiJar;
    const c = l => {
      const m = {};
      for (const [n, o] of Object.entries(l)) {
        if (o == null) continue;
        m[n] = Array.isArray(o) ? o[0] : String(o);
      }
      return m;
    };
    const d = (k, l = {}) => {
      const m = b.headerFor(k);
      return {
        'ja3': CHROME_JA3,
        'http2Fingerprint': CHROME_H2,
        'userAgent': CHROME_UA,
        'timeout': 0x3c,
        'proxy': a || undefined,
        'disableRedirect': true,
        'enableConnectionReuse': true,
        'headers': c({
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': CHROME_SEC_CH_UA,
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          ...(m ? { 'Cookie': m } : {}),
          ...l
        })
      };
    };
    const f = async (k, l = {}) => {
      const m = d(k, {
        'Accept': 'application/json',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...l
      });
      const n = await this._cycleTLS(k, m, 'get');
      b.capture(n.headers, n.finalUrl || k);
      return n;
    };
    const g = async (k, l = {}) => {
      const m = d(k, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        ...l
      });
      const n = await this._cycleTLS(k, m, 'get');
      b.capture(n.headers, n.finalUrl || k);
      return n;
    };
    const h = async (k, l, m = {}) => {
      const n = d(k, {
        'Accept': 'application/json',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...m
      });
      n.body = typeof l === 'string' ? l : JSON.stringify(l);
      const o = await this._cycleTLS(k, n, 'post');
      b.capture(o.headers, o.finalUrl || k);
      return o;
    };
    const i = async (k, l = 15) => {
      let m = k;
      let n;
      for (let o = 0; o < l; o++) {
        n = await g(m, { 'Referer': o === 0 ? BASE_CHATGPT + '/' : m });
        let p = n.headers?.['Location'] || n.headers?.['location'];
        if (Array.isArray(p)) p = p[0];
        if (n.status >= 300 && n.status < 400 && p && typeof p === 'string') {
          m = new URL(p, m).href;
        } else {
          break;
        }
      }
      return { ...n, 'finalUrl': m };
    };
    const j = k => {
      if (k.data && typeof k.data === 'object' && !Buffer.isBuffer(k.data)) return k.data;
      const l = Buffer.isBuffer(k.data) ? k.data.toString('utf8') : typeof k.data === 'string' ? k.data : null;
      if (!l) return null;
      try { return JSON.parse(l); } catch { return null; }
    };
    try {
      const k = (async () => {
        const E = new Set();
        try {
          const F = this.otpConfig.provider !== 'generator.email' && this.otpConfig.provider !== '2';
          let G;
          if (F && this.otpConfig.serviceDomain && (this.otpConfig.apiKey || this.otpConfig.provider === 'akbarmail')) {
            G = await fetchOtpTmailCandidates(this.email, this.otpConfig.serviceDomain, this.otpConfig.apiKey);
          } else {
            G = await fetchOtpGeneratorCandidates(this.email, this.otpConfig.geDomain, { 'quick': true });
          }
          for (const H of G) E.add(String(H));
        } catch {}
        return E;
      })();
      const l = await f(BASE_CHATGPT + '/api/auth/csrf');
      const m = j(l);
      if (!m?.['csrfToken']) throw new Error('CSRF gagal');
      logger.info(this.tag + 'Login: CSRF \u2713');
      const n = BASE_CHATGPT + '/api/auth/signin/openai?prompt=login&ext-oai-did=' + this.deviceId + '&auth_session_logging_id=' + this.sessionId + '&ext-passkey-client-capabilities=11';
      const o = 'callbackUrl=' + encodeURIComponent(BASE_CHATGPT + '/') + '&csrfToken=' + m.csrfToken + '&json=true';
      const p = await h(n, o, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE_CHATGPT,
        'Referer': BASE_CHATGPT + '/'
      });
      const q = j(p);
      if (!q?.['url']) throw new Error('Signin gagal');
      logger.info(this.tag + 'Login: Authorize URL \u2713');
      const r = await i(q.url);
      logger.info(this.tag + 'Login: Auth session \u2713');
      let s = new Set();
      try {
        s = await k;
      } catch (E) {
        logger.debug(this.tag + 'Baseline OTP fetch failed: ' + E.message?.substring(0, 80));
      }
      const t = uuidv4();
      const { sentinelToken: u } = await generateSentinelTokens(a, CHROME_UA, 'authorize_continue', t);
      const v = {
        'Content-Type': 'application/json',
        'Origin': BASE_AUTH,
        'Referer': r.finalUrl,
        'sec-fetch-site': 'same-origin'
      };
      if (u) v['OpenAI-Sentinel-Token'] = u;
      const w = await h(BASE_AUTH + '/api/accounts/authorize/continue', {
        'username': { 'kind': 'email', 'value': this.email }
      }, v);
      const x = j(w);
      if (!x?.['continue_url']) throw new Error('authorize/continue gagal');
      logger.info(this.tag + 'Login: Email submitted \u2713');
      const y = x?.['page']?.['payload']?.['email_verification_mode'];
      const z = x.continue_url;
      const A = z.includes('/email-verification') || y === 'login_challenge';
      let B = z;
      let C = y;
      if (A) {
        logger.info(this.tag + 'Login: OTP route (no password)');
      } else {
        const { sentinelToken: F } = await generateSentinelTokens(a, CHROME_UA, 'password_verify', t);
        const G = {
          'Content-Type': 'application/json',
          'Origin': BASE_AUTH,
          'Referer': BASE_AUTH + '/log-in/password',
          'sec-fetch-site': 'same-origin'
        };
        if (F) G['OpenAI-Sentinel-Token'] = F;
        const H = await h(BASE_AUTH + '/api/accounts/password/verify', { 'password': this.password }, G);
        const I = j(H);
        if (!I?.['continue_url']) {
          const J = I?.['error']?.['code'] || 'unknown';
          throw new Error('Password verify gagal: ' + J);
        }
        logger.info(this.tag + 'Login: Password \u2713');
        B = I.continue_url;
        C = I?.['page']?.['payload']?.['email_verification_mode'];
      }
      if (B.includes('/email-verification') || C === 'login_challenge') {
        logger.info(this.tag + 'Login: OTP challenge...');
        const K = this.otpConfig.provider !== 'generator.email' && this.otpConfig.provider !== '2';
        const L = async () => {
          if (K && this.otpConfig.serviceDomain && (this.otpConfig.apiKey || this.otpConfig.provider === 'akbarmail')) {
            return fetchOtpTmailCandidates(this.email, this.otpConfig.serviceDomain, this.otpConfig.apiKey);
          }
          return fetchOtpGeneratorCandidates(this.email, this.otpConfig.geDomain, { 'quick': true });
        };
        const M = new Set();
        for (const P of s) M.add(P);
        if (!A) {
          try {
            const Q = await L();
            for (const R of Q) M.add(String(R));
          } catch {}
        }
        if (M.size > 0) {
          logger.info(this.tag + 'Login: Baseline OTP excluded (' + M.size + ' codes)');
        }
        let N = false;
        const isAkbar = this.otpConfig.provider === 'akbarmail';
        const O = isAkbar
          ? [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]
          : (K ? [0x7530, 0x2710, 0x2710, 0x2710] : [0x2710, 0x2710, 0x2710, 0x2710, 0x2710, 0x2710]);
        for (let S = 0; S < O.length; S++) {
          const T = O.slice(0, S + 1).reduce((Z, a0) => Z + a0, 0) / 1000;
          logger.info(this.tag + 'Login: Waiting OTP... (' + T + 's)');
          await sleep(O[S]);
          let U;
          try { U = await L(); } catch { U = []; }
          const V = U.find(Z => !M.has(String(Z)));
          if (!V) continue;
          M.add(String(V));
          logger.info(this.tag + 'Login: Trying OTP ' + V + '...');
          const W = await h(BASE_AUTH + '/api/accounts/email-otp/validate', { 'code': V }, {
            'Content-Type': 'application/json',
            'Origin': BASE_AUTH,
            'Referer': BASE_AUTH + '/email-verification',
            'sec-fetch-site': 'same-origin'
          });
          const X = j(W);
          if (X?.['continue_url']) {
            B = X.continue_url;
            N = true;
            logger.info(this.tag + 'Login: OTP \u2713');
            break;
          }
          const Y = X?.['error']?.['code'] || 'unknown';
          if (Y === 'wrong_email_otp_code') {
            logger.warn(this.tag + 'Login: OTP mismatch, retrying...');
            continue;
          }
          throw new Error('OTP validate gagal: ' + Y);
        }
        if (!N) {
          const Z = new Error('OTP tidak diterima');
          Z.otpTimeout = true;
          throw Z;
        }
      }
      if (B.includes('callback') || B.includes('code=')) {
        await i(B);
      }
      let D = null;
      for (let a0 = 0; a0 < 3; a0++) {
        if (a0 > 0) await sleep(2000);
        const a1 = await f(BASE_CHATGPT + '/api/auth/session', { 'Referer': BASE_CHATGPT + '/' });
        const a2 = j(a1);
        if (a2?.['accessToken']) { D = a2.accessToken; break; }
        if (a2?.['access_token']) { D = a2.access_token; break; }
        if (a0 === 0 && a2) {
          logger.debug(this.tag + 'Session keys: [' + Object.keys(a2).join(', ') + ']');
        }
      }
      if (!D) {
        logger.debug(this.tag + 'Cookies: ' + b.allCookieNames().length + ' captured');
        throw new Error('Access token gagal didapat');
      }
      this.accessToken = D;
      logger.success(this.tag + 'Login: Token \u2713');
      return { 'accessToken': D };
    } catch (a3) {
      await this.cleanup();
      throw a3;
    }
  }

  async ['_followOAuthChain'](a) {
    let b = a;
    let c;
    for (let d = 0; d < 15; d++) {
      c = await this.client.get(b, {
        'maxRedirects': 0,
        'headers': {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': d === 0 ? BASE_AUTH + '/' : b
        }
      });
      logger.debug(this.tag + '  hop ' + d + ': ' + c.status);
      if (c.status >= 300 && c.status < 400 && c.headers.location) {
        b = new URL(c.headers.location, b).href;
      } else {
        break;
      }
    }
    logger.debug(this.tag + 'OAuth chain done');
    return { 'finalUrl': b, 'response': c };
  }

  async ['getPricingCountries']() {
    const a = await this._oaiGet(BASE_CHATGPT + '/backend-api/checkout_pricing_config/countries', {}, this.checkoutProxyUrl);
    logger.debug(this.tag + 'Pricing countries \u2713');
    return a.data;
  }

  async ['getPricingConfig']() {
    const a = await this._oaiGet(BASE_CHATGPT + '/backend-api/checkout_pricing_config/configs/ID', {}, this.checkoutProxyUrl);
    logger.debug(this.tag + 'Pricing config \u2713');
    return a.data;
  }

  async ['createCheckoutSession']() {
    try {
      const g = await this._oaiGet(BASE_CHATGPT + '/backend-api/promo_campaign/check_coupon?coupon=plus-1-month-free&is_coupon_from_query_param=true', {}, this.checkoutProxyUrl);
      const h = g.data;
      logger.info(this.tag + 'Coupon: ' + (h?.['state'] || 'unknown') + ' (redeemed=' + (h?.['redemption']?.['redeemed'] || false) + ')');
      if (h?.['state'] !== 'eligible') {
        const i = new Error('Coupon not eligible: ' + h?.['state']);
        i.hint = 'Promo plus-1-month-free tidak available untuk akun ini';
        throw i;
      }
    } catch (j) {
      if (j.hint) throw j;
      logger.warn(this.tag + 'check_coupon failed: ' + j.message?.substring(0, 100));
    }
    const a = {
      'plan_name': 'chatgptplusplan',
      'billing_details': { 'country': 'ID', 'currency': 'IDR' },
      'promo_campaign': { 'promo_campaign_id': 'plus-1-month-free', 'is_coupon_from_query_param': true },
      'entry_point': 'all_plans_pricing_modal'
    };
    const { sentinelToken: b } = await generateSentinelTokens(this.proxyUrl || '', CHROME_UA, 'chatgpt_checkout', this.deviceId);
    const c = {};
    if (b) c['OpenAI-Sentinel-Token'] = b;
    const d = await this._oaiPost(BASE_CHATGPT + '/backend-api/payments/checkout', a, c, this.checkoutProxyUrl);
    if (d.status !== 200) {
      const k = typeof d.data === 'string' ? d.data : JSON.stringify(d.data);
      logger.warn(this.tag + 'Checkout: ' + d.status);
      if (d.status === 403 && k.includes('cf_chl')) {
        throw new Error('Checkout blocked by Cloudflare (403)');
      }
      let l;
      try {
        const m = typeof d.data === 'object' ? d.data : JSON.parse(k);
        l = m?.['detail'] || m?.['error']?.['message'] || m?.['message'];
      } catch {}
      if (l) {
        l = typeof l === 'string' ? l : JSON.stringify(l);
        const n = new Error('Checkout: ' + l);
        if (l.toLowerCase().includes('already paying')) n.noRetry = true;
        throw n;
      }
      throw new Error('Checkout failed: ' + d.status + ' ' + (k.length > 200 ? k.substring(0, 200) + '...' : k));
    }
    const f = d.data;
    this.checkoutSessionId = f.checkout_session_id;
    this.publishableKey = f.publishable_key || STRIPE_PK;
    logger.success(this.tag + 'Checkout \u2713');
    return f;
  }

  async ['initStripeCheckout']() {
    const a = new URLSearchParams();
    a.append('browser_locale', 'en-US');
    a.append('browser_timezone', 'Asia/Jakarta');
    a.append('elements_session_client[client_betas][0]', 'custom_checkout_server_updates_1');
    a.append('elements_session_client[client_betas][1]', 'custom_checkout_manual_approval_1');
    a.append('elements_session_client[elements_init_source]', 'custom_checkout');
    a.append('elements_session_client[referrer_host]', 'chatgpt.com');
    a.append('elements_session_client[stripe_js_id]', this.stripeJsId);
    a.append('elements_session_client[locale]', 'en-US');
    a.append('elements_session_client[is_aggregation_expected]', 'false');
    a.append('elements_options_client[stripe_js_locale]', 'auto');
    a.append('elements_options_client[saved_payment_method][enable_save]', 'never');
    a.append('elements_options_client[saved_payment_method][enable_redisplay]', 'never');
    a.append('key', this.publishableKey);
    a.append('_stripe_version', STRIPE_VERSION);
    const b = await this.stripeClient.post(STRIPE_API + '/v1/payment_pages/' + this.checkoutSessionId + '/init', a.toString(), {
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/'
      }
    });
    this.initChecksum = b.data?.['init_checksum'] || b.data?.['checksum'];
    this.elementsSessionConfigId = b.data?.['elements_session_config_id'];
    this.checkoutConfigId = b.data?.['checkout_config_id'];
    logger.debug(this.tag + 'Stripe init \u2713' + (this.initChecksum ? ' (checksum: ' + this.initChecksum.substring(0, 10) + '...)' : ''));
    return b.data;
  }

  async ['initStripeSession']() {
    const a = new URLSearchParams({
      'client_betas[0]': 'custom_checkout_server_updates_1',
      'client_betas[1]': 'custom_checkout_manual_approval_1',
      'deferred_intent[mode]': 'subscription',
      'deferred_intent[amount]': '0',
      'deferred_intent[currency]': 'idr',
      'deferred_intent[setup_future_usage]': 'off_session',
      'deferred_intent[payment_method_types][0]': 'card',
      'deferred_intent[payment_method_types][1]': 'gopay',
      'currency': 'idr',
      'key': this.publishableKey,
      '_stripe_version': STRIPE_VERSION,
      'elements_init_source': 'custom_checkout',
      'referrer_host': 'chatgpt.com',
      'stripe_js_id': this.stripeJsId,
      'locale': 'en',
      'type': 'deferred_intent',
      'checkout_session_id': this.checkoutSessionId
    });
    let b;
    try {
      b = await this.stripeClient.post(STRIPE_API + '/v1/elements/sessions', a.toString(), {
        'headers': {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Origin': 'https://js.stripe.com',
          'Referer': 'https://js.stripe.com/'
        }
      });
    } catch {
      b = await this.stripeClient.get(STRIPE_API + '/v1/elements/sessions?' + a.toString(), {
        'headers': {
          'Accept': 'application/json',
          'Origin': 'https://js.stripe.com',
          'Referer': 'https://js.stripe.com/'
        }
      });
    }
    this.elementsSessionId = b.data?.['session']?.['id'] || b.data?.['id'] || null;
    logger.debug(this.tag + 'Stripe session \u2713');
    return b.data;
  }

  async ['createPaymentMethod'](a) {
    const b = new URLSearchParams();
    b.append('billing_details[name]', a.name);
    b.append('billing_details[email]', this.email);
    b.append('billing_details[address][country]', a.country);
    b.append('billing_details[address][line1]', a.line1);
    b.append('billing_details[address][city]', a.city);
    b.append('billing_details[address][postal_code]', a.postal_code);
    b.append('billing_details[address][state]', a.state);
    b.append('type', 'gopay');
    b.append('payment_user_agent', 'stripe.js/804ae66e17; stripe-js-v3/804ae66e17; payment-element; deferred-intent');
    b.append('referrer', 'https://chatgpt.com');
    b.append('time_on_page', String(Math.floor(Math.random() * 30000) + 30000));
    b.append('client_attribution_metadata[client_session_id]', this.stripeJsId);
    b.append('client_attribution_metadata[checkout_session_id]', this.checkoutSessionId);
    b.append('client_attribution_metadata[merchant_integration_source]', 'elements');
    b.append('client_attribution_metadata[merchant_integration_subtype]', 'payment-element');
    b.append('client_attribution_metadata[merchant_integration_version]', '2021');
    b.append('client_attribution_metadata[merchant_integration_additional_elements][0]', 'payment');
    b.append('client_attribution_metadata[merchant_integration_additional_elements][1]', 'address');
    b.append('client_attribution_metadata[payment_intent_creation_flow]', 'deferred');
    b.append('client_attribution_metadata[payment_method_selection_flow]', 'automatic');
    b.append('guid', uuidv4().replace(/-/g, '').substring(0, 36));
    b.append('muid', uuidv4().replace(/-/g, '').substring(0, 36));
    b.append('sid', uuidv4().replace(/-/g, '').substring(0, 36));
    b.append('key', this.publishableKey);
    b.append('_stripe_version', STRIPE_VERSION);
    const c = await this.stripeClient.post(STRIPE_API + '/v1/payment_methods', b.toString(), {
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Origin': 'https://js.stripe.com',
        'Referer': 'https://js.stripe.com/'
      }
    });
    if (c.status !== 200) {
      throw new Error('Create payment method failed: ' + c.status + ' ' + JSON.stringify(c.data));
    }
    this.paymentMethodId = c.data.id;
    logger.debug(this.tag + 'Payment method \u2713 (' + this.paymentMethodId + ')');
    return c.data;
  }

  async ['confirmCheckout'](a) {
    const b = BASE_CHATGPT + '/checkout/verify?stripe_session_id=' + this.checkoutSessionId + '&processor_entity=openai_llc&plan_type=plus';
    const c = new URLSearchParams();
    c.append('guid', uuidv4().replace(/-/g, '').substring(0, 36));
    c.append('muid', uuidv4().replace(/-/g, '').substring(0, 36));
    c.append('sid', uuidv4().replace(/-/g, '').substring(0, 36));
    c.append('payment_method', this.paymentMethodId);
    if (this.initChecksum) c.append('init_checksum', this.initChecksum);
    c.append('expected_amount', '0');
    c.append('expected_payment_method_type', 'gopay');
    c.append('return_url', b);
    c.append('consent[terms_of_service]', 'accepted');
    c.append('elements_session_client[client_betas][0]', 'custom_checkout_server_updates_1');
    c.append('elements_session_client[client_betas][1]', 'custom_checkout_manual_approval_1');
    c.append('elements_session_client[elements_init_source]', 'custom_checkout');
    c.append('elements_session_client[referrer_host]', 'chatgpt.com');
    if (a?.['session']?.['id']) c.append('elements_session_client[session_id]', a.session.id);
    c.append('elements_session_client[stripe_js_id]', this.stripeJsId);
    c.append('elements_session_client[locale]', 'en');
    c.append('elements_session_client[is_aggregation_expected]', 'false');
    c.append('elements_options_client[stripe_js_locale]', 'auto');
    c.append('elements_options_client[saved_payment_method][enable_save]', 'never');
    c.append('elements_options_client[saved_payment_method][enable_redisplay]', 'never');
    c.append('client_attribution_metadata[client_session_id]', this.stripeJsId);
    c.append('client_attribution_metadata[checkout_session_id]', this.checkoutSessionId);
    c.append('client_attribution_metadata[merchant_integration_source]', 'elements');
    c.append('client_attribution_metadata[merchant_integration_version]', '2021');
    c.append('client_attribution_metadata[merchant_integration_subtype]', 'payment-element');
    c.append('client_attribution_metadata[merchant_integration_additional_elements][0]', 'payment');
    c.append('client_attribution_metadata[merchant_integration_additional_elements][1]', 'address');
    c.append('client_attribution_metadata[payment_intent_creation_flow]', 'deferred');
    c.append('client_attribution_metadata[payment_method_selection_flow]', 'automatic');
    if (a?.['session']?.['id']) c.append('client_attribution_metadata[elements_session_id]', a.session.id);
    if (this.elementsSessionConfigId) c.append('client_attribution_metadata[elements_session_config_id]', this.elementsSessionConfigId);
    if (this.checkoutConfigId) c.append('client_attribution_metadata[checkout_config_id]', this.checkoutConfigId);
    c.append('key', this.publishableKey);
    c.append('_stripe_version', STRIPE_VERSION);
    const d = await this.stripeClient.post(STRIPE_API + '/v1/payment_pages/' + this.checkoutSessionId + '/confirm', c.toString(), {
      'headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Origin': 'https://pay.openai.com',
        'Referer': 'https://pay.openai.com/'
      }
    });
    if (d.status !== 200) {
      const e = JSON.stringify(d.data || '');
      const f = d.data?.['error'] || {};
      const g = f.code || '';
      const h = f.decline_code || '';
      const i = f.message || '';
      if (e.includes('checkout_amount_mismatch')) {
        const j = new Error('Akun tidak tersedia trial!');
        j.hint = 'Akun ini sudah pernah pakai trial atau amount tidak cocok';
        throw j;
      }
      if (g === 'payment_method_provider_decline') {
        const k = new Error('GoPay ditolak: ' + (h || 'provider_decline') + ' \u2014 ' + i);
        k.hint = 'GoPay processing error. Coba: (1) tunggu 15-30 menit, (2) cek saldo & status GoPay di Gojek, (3) ganti nomor GoPay lain';
        throw k;
      }
      if (g) throw new Error('Stripe ' + d.status + ': [' + g + '] ' + (h ? '(' + h + ') ' : '') + i);
      throw new Error('Confirm checkout failed: ' + d.status + ' ' + e);
    }
    logger.success(this.tag + 'Stripe confirmed \u2713');
    return d.data;
  }

  async ['followStripeRedirect'](a) {
    let b = null;
    const c = j => {
      if (!j || typeof j !== 'object') return null;
      if (j.status === 'succeeded') return 'SUCCEEDED';
      if (j.next_action?.['redirect_to_url']?.['url']) return j.next_action.redirect_to_url.url;
      if (j.next_action?.['use_stripe_sdk']?.['stripe_js']) return j.next_action.use_stripe_sdk.stripe_js;
      if (j.next_action?.['use_stripe_sdk']?.['url']) return j.next_action.use_stripe_sdk.url;
      if (j.next_action?.['type'] === 'redirect_to_url' && j.next_action?.['url']) return j.next_action.url;
      const k = JSON.stringify(j);
      const l = k.match(/https?:\\?\/\\?\/pm-redirects\.stripe\.com[^"\\]*/);
      if (l) return l[0].replace(/\\\//g, '/');
      const n = k.match(/https?:\\?\/\\?\/app\.midtrans\.com[^"\\]*/);
      if (n) return n[0].replace(/\\\//g, '/');
      return null;
    };
    const e = encodeURIComponent(STRIPE_VERSION);
    const f = async j => {
      const k = j.startsWith('seti_') ? 'setup_intents' : 'payment_intents';
      logger.debug(this.tag + 'Fetching ' + k + '/' + j + '...');
      const l = await this.stripeClient.get(STRIPE_API + '/v1/' + k + '/' + j + '?key=' + this.publishableKey + '&_stripe_version=' + e, {
        'headers': { 'Accept': 'application/json', 'Origin': 'https://js.stripe.com', 'Referer': 'https://js.stripe.com/' }
      });
      return l.status === 200 ? l.data : null;
    };
    if (a?.['next_action']?.['redirect_to_url']?.['url']) {
      b = a.next_action.redirect_to_url.url;
    }
    if (!b) {
      let j = a?.['setup_intent'];
      let k = a?.['payment_intent'];
      if (typeof j === 'object' && j) {
        const l = c(j);
        if (l === 'SUCCEEDED') return { 'alreadySucceeded': true };
        if (l) b = l;
      }
      if (!b && typeof k === 'object' && k) {
        const m = c(k);
        if (m === 'SUCCEEDED') return { 'alreadySucceeded': true };
        if (m) b = m;
      }
      if (!b && typeof k === 'string') {
        const n = await f(k);
        const o = c(n);
        if (o === 'SUCCEEDED') return { 'alreadySucceeded': true };
        if (o) b = o;
      }
      if (!b && typeof j === 'string') {
        const p = await f(j);
        const q = c(p);
        if (q === 'SUCCEEDED') return { 'alreadySucceeded': true };
        if (q) b = q;
      }
      if (!b) {
        logger.info(this.tag + 'Waiting for redirect...');
        for (let t = 0; t < 6; t++) {
          await sleep(5000);
          const u = await this.stripeClient.get(STRIPE_API + '/v1/payment_pages/' + this.checkoutSessionId + '?key=' + this.publishableKey + '&_stripe_version=' + e, {
            'headers': { 'Accept': 'application/json', 'Origin': 'https://pay.openai.com', 'Referer': 'https://pay.openai.com/' }
          });
          if (u.status === 200) {
            const v = u.data;
            if (v?.['setup_intent']) {
              const w = c(v.setup_intent);
              if (w === 'SUCCEEDED') return { 'alreadySucceeded': true };
              if (w) { b = w; break; }
            }
            if (v?.['payment_intent']) {
              const x = c(v.payment_intent);
              if (x === 'SUCCEEDED') return { 'alreadySucceeded': true };
              if (x) { b = x; break; }
            }
            if (v?.['next_action']?.['redirect_to_url']?.['url']) {
              b = v.next_action.redirect_to_url.url;
              break;
            }
            logger.info(this.tag + 'Poll ' + (t + 1) + '/6: status=' + v?.['status']);
          }
        }
        if (!b) {
          const y = new Error('[GoPay] Redirect URL not found after polling');
          y.hint = 'Stripe session tidak menghasilkan redirect URL';
          throw y;
        }
      }
    }
    if (!b) {
      const z = JSON.stringify(a);
      const A = z.match(/https?:\\?\/\\?\/pm-redirects\.stripe\.com[^"\\]*/);
      if (A) {
        b = A[0].replace(/\\\//g, '/');
      } else {
        const B = z.match(/https?:\\?\/\\?\/app\.midtrans\.com[^"\\]*/);
        if (B) b = B[0].replace(/\\\//g, '/');
      }
    }
    if (!b) {
      const C = a || {};
      const D = JSON.stringify(C, null, 2);
      logger.warn(this.tag + 'No redirect URL found \u2014 status=' + C.status + ' approval=' + C.approval_method + ' si=' + (C.setup_intent ? 'yes' : 'null') + ' pi=' + (C.payment_intent ? 'yes' : 'null'));
      logger.debug(this.tag + 'Dump: ' + D.substring(0, 1500));
      throw new Error('[GoPay] Stripe redirect URL not found after polling');
    }
    logger.debug(this.tag + 'Following Stripe redirect...');
    const i = await this.midtransClient.get(b, {
      'maxRedirects': 0,
      'validateStatus': E => E < 500,
      'headers': {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://chatgpt.com/'
      }
    });
    if (i.status === 302 || i.status === 301) {
      const E = i.headers.location;
      const F = E.match(/\/snap\/v4\/redirection\/([a-f0-9-]+)/);
      if (F) {
        this.midtransSnapId = F[1];
        const G = b.match(/sa_nonce_([A-Za-z0-9]+)/);
        if (G) this.stripeReturnNonce = G[1];
        logger.debug(this.tag + 'Midtrans SNAP \u2713 (' + this.midtransSnapId + ')');
        return { 'snapId': this.midtransSnapId, 'redirectUrl': E };
      }
    }
    throw new Error('Unexpected redirect response: ' + i.status + ' ' + (i.headers.location || 'no location'));
  }

  async ['getMidtransTransaction']() {
    const a = await this.midtransClient.get(MIDTRANS_API + '/snap/v1/transactions/' + this.midtransSnapId, {
      'headers': { ...this._midtransHeaders(), 'Referer': MIDTRANS_API + '/snap/v4/redirection/' + this.midtransSnapId }
    });
    logger.debug(this.tag + 'Midtrans transaction \u2713');
    return a.data;
  }

  async ['linkGoPay']() {
    const a = { 'type': 'gopay', 'country_code': '62', 'phone_number': this.gopayPhone };
    const b = await this.midtransClient.post(MIDTRANS_API + '/snap/v3/accounts/' + this.midtransSnapId + '/linking', a, {
      'headers': { ...this._midtransHeaders(), 'Referer': MIDTRANS_API + '/snap/v4/redirection/' + this.midtransSnapId }
    });
    if (b.status !== 201 && b.status !== 200) {
      const c = JSON.stringify(b.data || '');
      if ((b.status === 406 || b.status === 410) && c.includes('already linked')) {
        const d = new Error('GoPay sudah terhubung!');
        d.hint = 'Unlink: Pengaturan \u2192 Aplikasi Terhubung';
        d.noRetry = true;
        throw d;
      }
      throw new Error('GoPay linking failed: ' + b.status + ' ' + c);
    }
    this.gopayReference = b.data?.['reference'] || b.data?.['gopay_reference'] || b.data?.['id'];
    if (!this.gopayReference && b.data) {
      const e = JSON.stringify(b.data);
      const f = e.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
      if (f) this.gopayReference = f[0];
    }
    logger.success(this.tag + 'GoPay linked \u2713');
    return b.data;
  }

  async ['gopayAuthorize'](a) {
    const b = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': GOPAY_MERCHANTS_APP,
      'Referer': GOPAY_MERCHANTS_APP + '/',
      'x-user-locale': 'en-US'
    };
    // FIX 3: restored actual API call to validate-reference
    try {
      const d = await this.midtransClient.post(GOPAY_GWA_API + '/v1/linking/validate-reference', {
        'reference_id': this.gopayReference
      }, { 'headers': b });
      logger.debug(this.tag + 'GoPay validate-reference \u2713');
    } catch (f) {
      logger.debug(this.tag + 'Validate reference: ' + f.message);
    }
    const c = await this.midtransClient.post(GOPAY_GWA_API + '/v1/linking/user-consent', {
      'reference_id': this.gopayReference
    }, { 'headers': b });
    if (c.status !== 200) {
      throw new Error('GoPay user-consent failed: ' + c.status);
    }
    logger.debug(this.tag + 'GoPay consent \u2713 (OTP sent to WhatsApp)');
    return c.data;
  }

  async ['handleGoPayOtpAndPin']() {
    let a;
    if (this._otpInputFn) {
      logger.info(this.tag + 'GoPay OTP + PIN: waiting OTP from external source...');
      a = await this._otpInputFn();
    } else {
      // FIX 2: restored \x1b ANSI escape codes for colored console output
      const m = { 'cyan': '\x1b[36m', 'yellow': '\x1b[33m', 'green': '\x1b[32m', 'reset': '\x1b[0m', 'bold': '\x1b[1m' };
      console.log('\n' + m.bold + m.yellow + '=======================================' + m.reset);
      console.log(m.bold + m.cyan + '  GoPay OTP Verification' + m.reset);
      console.log(m.yellow + '  OTP sent to WhatsApp: +62' + this.gopayPhone + m.reset);
      console.log(m.bold + m.yellow + '=======================================' + m.reset + '\n');
      a = await getUserInput(m.green + 'Enter OTP from WhatsApp: ' + m.reset);
    }
    a = String(a || '').trim();
    if (!a || a.length < 4) throw new Error('Invalid OTP code');
    logger.debug(this.tag + 'OTP entered: ' + a);
    const b = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': GOPAY_MERCHANTS_APP,
      'Referer': GOPAY_MERCHANTS_APP + '/',
      'x-user-locale': 'en-US'
    };
    const c = await this.midtransClient.post(GOPAY_GWA_API + '/v1/linking/validate-otp', {
      'reference_id': this.gopayReference,
      'otp': a
    }, { 'headers': b });
    if (c.status !== 200) throw new Error('GoPay validate-otp failed: ' + c.status);
    logger.debug(this.tag + 'GoPay OTP validated \u2713');
    let d = c.data?.['challenge_id'];
    if (!d) {
      const n = JSON.stringify(c.data);
      const o = n.match(/challengeId[=:]([a-f0-9-]{36})/i);
      if (o) d = o[1];
    }
    if (!d) throw new Error('No challengeId from validate-otp response');
    const f = uuidv4();
    const g = uuidv4();
    const h = {
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://pin-web-client.gopayapi.com',
      'Referer': 'https://pin-web-client.gopayapi.com/',
      'x-appversion': '1.0.0',
      'x-correlation-id': f,
      'x-is-mobile': 'false',
      'x-platform': 'Windows 10',
      'x-request-id': g,
      'x-user-locale': 'id'
    };
    // FIX 4: restored actual GET request to pin-page
    const i = GOPAY_MERCHANTS_APP + '/payment/provider-redirect?reference=' + this.gopayReference + '&action=linking-validate-pin';
    try {
      const p = await this.midtransClient.get(GOPAY_CUSTOMER_API + '/api/v2/challenges/' + d + '/pin-page/nb', {
        'params': { 'redirect_url': i, 'action': 'linking-validate-pin' },
        'headers': h
      });
      logger.debug(this.tag + 'GoPay PIN page \u2713');
    } catch (q) {
      logger.debug(this.tag + 'PIN page: ' + q.message);
    }
    const j = await this.midtransClient.post(GOPAY_CUSTOMER_API + '/api/v1/users/pin/tokens/nb', {
      'challenge_id': d,
      'client_id': GOPAY_PIN_CLIENT_ID,
      'pin': this.gopayPin
    }, { 'headers': { ...h, 'Content-Type': 'application/json' } });
    if (j.status !== 200) throw new Error('GoPay PIN submit failed: ' + j.status);
    let k = j.data?.['token'];
    if (!k && j.data) {
      const r = JSON.stringify(j.data);
      const s = r.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (s) k = s[0];
    }
    if (!k) throw new Error('No JWT token from PIN submit');
    logger.debug(this.tag + 'GoPay PIN verified \u2713');
    const l = await this.midtransClient.post(GOPAY_GWA_API + '/v1/linking/validate-pin', {
      'reference_id': this.gopayReference,
      'token': k
    }, { 'headers': b });
    if (l.status !== 200) throw new Error('GoPay validate-pin failed: ' + l.status);
    logger.success(this.tag + 'GoPay linking done \u2713');
    return l.data;
  }

  async ['waitForLinkingCallback']() {
    for (let a = 0; a < 12; a++) {
      await sleep(5000);
      try {
        const b = await this.midtransClient.get(MIDTRANS_API + '/snap/v1/transactions/' + this.midtransSnapId, {
          'headers': { ...this._midtransHeaders(), 'Referer': MIDTRANS_API + '/snap/v4/redirection/' + this.midtransSnapId }
        });
        const c = b.data;
        if (c?.['gopay_account_id'] || c?.['payment_type'] === 'gopay' || c?.['status_code'] === '200') {
          logger.debug(this.tag + 'GoPay linking confirmed');
          return c;
        }
        logger.debug(this.tag + 'Waiting for linking... (' + (a + 1) + '/12)');
      } catch (d) {
        logger.debug(this.tag + 'Poll error: ' + d.message);
      }
    }
    logger.debug(this.tag + 'Linking poll timeout, proceeding...');
    return null;
  }

  async ['chargeGoPay']() {
    const a = { 'payment_type': 'gopay', 'tokenization': 'true', 'promo_details': null };
    const b = await this.midtransClient.post(MIDTRANS_API + '/snap/v2/transactions/' + this.midtransSnapId + '/charge', a, {
      'headers': { ...this._midtransHeaders(), 'Referer': MIDTRANS_API + '/snap/v4/redirection/' + this.midtransSnapId }
    });
    if (b.status !== 200) throw new Error('GoPay charge failed: ' + b.status + ' ' + JSON.stringify(b.data));
    logger.success(this.tag + 'Charge initiated \u2713');
    return b.data;
  }

  async ['handleChargePin'](a) {
    const b = {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': GOPAY_MERCHANTS_APP,
      'Referer': GOPAY_MERCHANTS_APP + '/'
    };
    let c = a?.['reference_id'] || a?.['gopay_reference'];
    if (!c && a?.['redirect_url']) {
      const g = a.redirect_url.match(/reference[_=]([A-Za-z0-9]+)/);
      if (g) c = g[1];
    }
    if (!c && a?.['authorize_url']) {
      const h = a.authorize_url.match(/reference[=]([A-Za-z0-9-]+)/);
      if (h) c = h[1];
    }
    if (!c) {
      const i = JSON.stringify(a);
      const j = i.match(/reference[_"]?\s*[:=]\s*"?([A-Za-z0-9-]+)/);
      if (j) c = j[1];
    }
    if (!c) {
      logger.debug(this.tag + 'No payment reference found');
      logger.debug(this.tag + 'Waiting for charge processing...');
      await sleep(10000);
      return null;
    }
    // FIX 5: restored actual GET request to payment/validate
    try {
      const k = await this.midtransClient.get(GOPAY_GWA_API + '/v1/payment/validate', {
        'params': { 'reference_id': c },
        'headers': b
      });
      logger.debug(this.tag + 'Payment validated \u2713');
    } catch (l) {
      logger.debug(this.tag + 'Payment validate: ' + l.message);
    }
    let d = null;
    try {
      const m = await this.midtransClient.post(GOPAY_GWA_API + '/v1/payment/confirm', {
        'payment_instructions': []
      }, { 'params': { 'reference_id': c }, 'headers': b });
      d = m.data;
      logger.debug(this.tag + 'Payment confirmed \u2713');
    } catch (n) {
      logger.debug(this.tag + 'Payment confirm: ' + n.message);
    }
    let f = d?.['challenge_id'];
    if (!f && d) {
      const o = JSON.stringify(d);
      const p = o.match(/challenge[_"]?i?d?[_"]?\s*[:=]\s*"?([a-f0-9-]{36})/i);
      if (p) f = p[1];
    }
    if (f) {
      logger.debug(this.tag + 'Charge PIN challenge: ' + f.substring(0, 8) + '...');
      const q = '47180a8e-f56e-11ed-a05b-0242ac120003-GWC';
      const r = await this.midtransClient.post(GOPAY_CUSTOMER_API + '/api/v1/users/pin/tokens/nb', {
        'pin': this.gopayPin,
        'challenge_id': f,
        'client_id': q
      }, {
        'headers': {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Origin': GOPAY_MERCHANTS_APP,
          'Referer': GOPAY_MERCHANTS_APP + '/',
          'x-request-id': uuidv4()
        }
      });
      if (r.status !== 200) throw new Error('Charge PIN failed: ' + r.status);
      let s = r.data?.['token'];
      if (!s && r.data) {
        const u = JSON.stringify(r.data);
        const v = u.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (v) s = v[0];
      }
      if (!s) throw new Error('No JWT token from charge PIN submit');
      logger.debug(this.tag + 'Charge PIN verified \u2713');
      const t = await this.midtransClient.post(GOPAY_GWA_API + '/v1/payment/process', {
        'challenge': { 'type': 'GOPAY_PIN_CHALLENGE', 'value': { 'pin_token': s } }
      }, { 'params': { 'reference_id': c }, 'headers': b });
      logger.success(this.tag + 'Payment processed \u2713');
      return t.data;
    }
    logger.debug(this.tag + 'Payment confirmed without PIN');
    return d;
  }

  async ['checkTransactionStatus']() {
    for (let c = 0; c < 18; c++) {
      try {
        const d = await this.midtransClient.get(MIDTRANS_API + '/snap/v1/transactions/' + this.midtransSnapId + '/status', {
          'headers': { ...this._midtransHeaders(), 'Referer': MIDTRANS_API + '/snap/v4/redirection/' + this.midtransSnapId }
        });
        const e = d.data?.['transaction_status'];
        const f = d.data?.['status_code'];
        logger.debug(this.tag + 'Status: ' + (e || 'unknown') + ' [' + (c + 1) + '/18]');
        if (e === 'settlement' || e === 'capture' || f === '200') {
          logger.success(this.tag + 'Settlement \u2713');
          return d.data;
        }
        if (e === 'pending' || !e) { await sleep(5000); continue; }
        if (e === 'deny' || e === 'cancel' || e === 'expire' || e === 'failure') {
          throw new Error('Payment ' + e);
        }
        await sleep(5000);
      } catch (g) {
        if (g.code === 'ECONNABORTED' || g.message.includes('timeout')) {
          logger.debug(this.tag + 'Poll timeout, retrying... [' + (c + 1) + '/18]');
          await sleep(5000);
          continue;
        }
        throw g;
      }
    }
    throw new Error('Payment status check timeout');
  }

  async ['verifyCheckout']() {
    const a = BASE_CHATGPT + '/checkout/verify?stripe_session_id=' + this.checkoutSessionId + '&processor_entity=openai_llc&plan_type=plus';
    // FIX 6: restored first _oaiGetHtml call with Referer: checkout.stripe.com
    const b = await this._oaiGetHtml(a, { 'Referer': 'https://checkout.stripe.com/' });
    logger.debug(this.tag + 'Checkout verify \u2713');
    await sleep(3000);
    const c = await this._oaiGetHtml(a + '&refresh_account=true', { 'Referer': a });
    logger.success(this.tag + 'ChatGPT Plus \u2713');
    return c.data;
  }

  async ['checkSubscriptionStatus']() {
    const a = await this._oaiGet(BASE_CHATGPT + '/backend-api/payments/checkout/openai_llc/' + this.checkoutSessionId);
    if (a.data?.['payment_status'] === 'paid' && a.data?.['status'] === 'complete') {
      logger.success(this.tag + 'Subscription: ' + a.data.plan_name + ' \u2713');
      return true;
    }
    return false;
  }

  async ['runAutopay']() {
    try {
      if (!this.skipLogin) {
        logger.info(this.tag + 'Login...');
        await this.loginToChatGPT();
      } else {
        if (!this._cycleTLS) {
          this._cycleTLS = this.sharedCycleTLS || (await initCycleTLS());
          this._oaiJar = new LoginCookieJar();
        }
      }
      logger.info(this.tag + 'Pricing...');
      await Promise.all([this.getPricingCountries(), this.getPricingConfig()]);
      logger.info(this.tag + 'Checkout...');
      await this.createCheckoutSession();
      logger.info(this.tag + 'Stripe init...');
      const a = generateBillingAddress(this.name);
      const [, b] = await Promise.all([this.initStripeCheckout(), this.initStripeSession(), this.createPaymentMethod(a)]);
      logger.info(this.tag + 'Stripe confirm...');
      const c = await this.confirmCheckout(b);
      this._pastStripe = true;
      logger.info(this.tag + 'Midtrans redirect...');
      const d = await this.followStripeRedirect(c);
      if (d?.['alreadySucceeded']) {
        logger.info(this.tag + 'Intent already succeeded, skipping GoPay...');
        await sleep(5000);
        logger.info(this.tag + 'Verify checkout...');
        await this.verifyCheckout();
      } else {
        await this.getMidtransTransaction();
        logger.info(this.tag + 'GoPay link (+62' + this.gopayPhone + ')...');
        this._gopayLinked = true;
        const f = await this.linkGoPay();
        await this.gopayAuthorize(f);
        logger.info(this.tag + 'GoPay OTP + PIN...');
        await this.handleGoPayOtpAndPin();
        await sleep(5000);
        logger.info(this.tag + 'GoPay charge...');
        const g = await this.chargeGoPay();
        await this.handleChargePin(g);
        await sleep(10000);
        logger.info(this.tag + 'Settlement check...');
        await this.checkTransactionStatus();
        logger.info(this.tag + 'Verify checkout...');
        await this.verifyCheckout();
        if (this.adbPath && this.deviceSerial) {
          logger.info(this.tag + 'Unlinking GoPay (OpenAI LLC)...');
          try {
            const h = await unlinkOpenAIFromGoPay(this.adbPath, this.deviceSerial);
            if (h) {
              logger.success(this.tag + 'GoPay unlinked \u2713');
            } else {
              logger.warn(this.tag + 'GoPay unlink: operation completed but confirmation unclear');
            }
          } catch (i) {
            logger.warn(this.tag + 'GoPay unlink failed: ' + i.message?.substring(0, 100));
          }
        }
      }
      const e = await this.checkSubscriptionStatus();
      return {
        'success': true,
        'email': this.email,
        'password': this.password,
        'plan': 'ChatGPT Plus',
        'paymentMethod': 'GoPay',
        'checkoutSessionId': this.checkoutSessionId,
        'isPaid': e
      };
    } catch (j) {
      const k = j.message.length > 150 ? j.message.substring(0, 150) + '...' : j.message;
      logger.debug(this.tag + 'Autopay error: ' + k);
      const l = this._pastStripe ? 'GoPay' : this.accessToken ? 'Checkout' : 'Login';
      const m = this._gopayLinked === true;
      return {
        'success': false,
        'email': this.email,
        'error': '[' + l + '] ' + j.message.substring(0, 100),
        'hint': j.hint || null,
        'noRetry': !!j.hint || !!this._pastStripe || l === 'Checkout',
        'otpTimeout': !!j.otpTimeout,
        'gopayLinked': m
      };
    } finally {
      await this.cleanup();
    }
  }
}

module.exports = ChatGPTAutopay;
