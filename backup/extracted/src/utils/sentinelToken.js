/**
 * OpenAI Sentinel Token Generator
 * 
 * Reverse-engineered from sentinel.openai.com/sentinel/{version}/sdk.js
 * 
 * Flow:
 *   1. Build browser fingerprint array
 *   2. Generate requirements proof (gAAAAAC prefix, trivial PoW)
 *   3. POST to sentinel.openai.com/backend-api/sentinel/req
 *   4. Server returns {token, proofofwork: {seed, difficulty}, turnstile, so}
 *   5. Solve real PoW using server's seed+difficulty (FNV-1a hash)
 *   6. Assemble final sentinel-token: {p, t, c, id, flow}
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('./logger');
const { solveTurnstileDx } = require('./sentinelVM');

const SENTINEL_BASE = 'https://chatgpt.com/backend-api/sentinel/';
const SENTINEL_VERSION = '20260219f9f6';
const SDK_URL = 'https://sentinel.openai.com/backend-api/sentinel/sdk.js';
const FRAME_REFERER = `https://chatgpt.com/backend-api/sentinel/frame.html?sv=${SENTINEL_VERSION}`;

// Must match CHROME_UA in apiSignup.js — the register request uses this UA via CycleTLS.
// If sentinel fingerprint has a different UA than the register request, server detects mismatch → 400.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Chrome 147 TLS fingerprint — must match apiSignup.js
const CHROME_JA3 = '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
const CHROME_H2 = '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p';

// ── FNV-1a 32-bit hash with murmur3 finalizer ──────────────────────────

function fnv1aHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── Base64 encode a JSON array (matches browser btoa(TextEncoder)) ──────

function encodeProof(arr) {
  return Buffer.from(JSON.stringify(arr), 'utf8').toString('base64');
}

// ── Build fake browser fingerprint array ────────────────────────────────

const NAV_PROPS = [
  'vendorSub', 'productSub', 'vendor', 'maxTouchPoints', 'scheduling',
  'userActivation', 'doNotTrack', 'geolocation', 'connection', 'plugins',
  'mimeTypes', 'pdfViewerEnabled', 'webkitTemporaryStorage',
  'hardwareConcurrency', 'cookieEnabled', 'appCodeName', 'appName',
  'appVersion', 'platform', 'product', 'userAgent', 'language',
  'languages', 'onLine', 'webdriver', 'getGamepads', 'javaEnabled',
  'sendBeacon', 'vibrate', 'bluetooth', 'clipboard', 'credentials',
  'keyboard', 'managed', 'mediaDevices', 'storage', 'serviceWorker',
  'virtualKeyboard', 'wakeLock', 'deviceMemory', 'ink', 'hid', 'locks',
  'gpu', 'mediaCapabilities', 'mediaSession', 'permissions',
  'presentation', 'serial', 'usb', 'windowControlsOverlay', 'xr',
  'userAgentData', 'joinAdInterestGroup', 'leaveAdInterestGroup',
  'updateAdInterestGroups', 'registerProtocolHandler',
];

const NAV_TOSTRINGS = [
  'function sendBeacon() { [native code] }',
  'function vibrate() { [native code] }',
  'function javaEnabled() { [native code] }',
  'function getGamepads() { [native code] }',
  '[object VirtualKeyboard]',
  '[object Geolocation]',
  '[object Clipboard]',
  '[object PluginArray]',
  '[object MimeTypeArray]',
  '[object MediaDevices]',
  '[object Permissions]',
  'function updateAdInterestGroups() { [native code] }',
  '[object StorageManager]',
  '[object ServiceWorkerContainer]',
  '[object NetworkInformation]',
  '[object Scheduling]',
  '[object UserActivation]',
];

const DOC_PROPS = [
  'location', 'implementation', 'URL', 'documentURI', 'compatMode',
  'characterSet', 'contentType', 'doctype', 'documentElement', 'domain',
  'referrer', 'cookie', 'lastModified', 'readyState', 'title', 'dir',
  'body', 'head', 'images', 'embeds', 'plugins', 'links', 'forms',
  'scripts', 'currentScript', 'defaultView', 'designMode', 'anchors',
  'fgColor', 'bgColor', 'alinkColor', 'linkColor', 'vlinkColor', 'all',
  'scrollingElement', 'hidden', 'visibilityState', 'timeline',
  'fullscreenEnabled', 'rootElement', 'children', 'firstElementChild',
  'lastElementChild', 'childElementCount', 'activeElement', 'styleSheets',
  'pointerLockElement', 'fullscreenElement', 'adoptedStyleSheets',
  'fonts', 'fragmentDirective', 'pictureinpictureenabled',
];

const WIN_EVENTS = [
  'onabort', 'onafterprint', 'onanimationend', 'onanimationiteration',
  'onanimationstart', 'onauxclick', 'onbeforeinput', 'onbeforeprint',
  'onbeforetoggle', 'onbeforeunload', 'onblur', 'oncancel', 'oncanplay',
  'oncanplaythrough', 'onchange', 'onclick', 'onclose', 'oncontextmenu',
  'ondblclick', 'ondevicemotion', 'ondeviceorientation', 'ondrag',
  'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart',
  'ondrop', 'onemptied', 'onended', 'onerror', 'onfocus', 'onformdata',
  'ongotpointercapture', 'onhashchange', 'oninput', 'oninvalid',
  'onkeydown', 'onkeypress', 'onkeyup', 'onlanguagechange', 'onload',
  'onloadeddata', 'onloadedmetadata', 'onloadstart',
  'onlostpointercapture', 'onmessage', 'onmessageerror', 'onmousedown',
  'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout',
  'onmouseover', 'onmouseup', 'onoffline', 'ononline', 'onpagehide',
  'onpageshow', 'onpaste', 'onpause', 'onplay', 'onplaying',
  'onpointercancel', 'onpointerdown', 'onpointerenter', 'onpointerleave',
  'onpointermove', 'onpointerout', 'onpointerover', 'onpointerup',
  'onpopstate', 'onprogress', 'onratechange', 'onrejectionhandled',
  'onreset', 'onresize', 'onscroll', 'onscrollend', 'onsearch',
  'onseeked', 'onseeking', 'onselect', 'onselectstart', 'onslotchange',
  'onstalled', 'onstorage', 'onsubmit', 'onsuspend', 'ontimeupdate',
  'ontoggle', 'ontransitioncancel', 'ontransitionend', 'ontransitionrun',
  'ontransitionstart', 'onunhandledrejection', 'onunload',
  'onvolumechange', 'onwaiting', 'onwebkitanimationend',
  'onwebkitanimationstart', 'onwebkittransitionend', 'onwheel',
  'onbeforematch', 'oncontentvisibilityautostatechange', 'oncontextlost',
  'oncontextrestored', 'oncuechange', 'ondurationchange', 'onendsnapshot',
];

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildFingerprint(userAgent, sid) {
  const screenW = 1920, screenH = 1080;
  const dateStr = new Date().toString();
  const timeOrigin = Date.now();
  const perfNow = Math.random() * 20000 + 5000;

  const navProp = randomPick(NAV_PROPS);
  const toString = randomPick(NAV_TOSTRINGS);
  const featureStr = `${navProp}\u2212${toString}`;

  return [
    screenW + screenH,              // [0]  screen.width + screen.height
    dateStr,                        // [1]  new Date().toString()
    Math.floor(Math.random() * 4294967296), // [2] performance-related seed
    0,                              // [3]  iteration (overwritten by PoW)
    userAgent,                      // [4]  navigator.userAgent
    SDK_URL,                        // [5]  script src
    null,                           // [6]  version/config
    'en-US',                        // [7]  navigator.language
    'en-US,en',                     // [8]  navigator.languages
    0,                              // [9]  elapsed ms (overwritten by PoW)
    featureStr,                     // [10] T() — random nav prop check
    randomPick(DOC_PROPS),          // [11] random document property
    randomPick(WIN_EVENTS),         // [12] random window event
    perfNow,                        // [13] performance.now()
    sid,                            // [14] sentinel session ID
    '',                             // [15] URL search params
    12,                             // [16] navigator.hardwareConcurrency
    timeOrigin,                     // [17] performance.timeOrigin
    0, 0, 0, 0, 0, 0, 0,           // [18-24] feature checks (in-window flags)
  ];
}

// ── Proof-of-Work solver ────────────────────────────────────────────────

function solvePoW(seed, difficulty, fingerprint, maxAttempts = 500000) {
  const startTime = Date.now();
  for (let i = 0; i < maxAttempts; i++) {
    fingerprint[3] = i;
    fingerprint[9] = Date.now() - startTime;
    const encoded = encodeProof(fingerprint);
    const hash = fnv1aHash(seed + encoded);
    if (hash.substring(0, difficulty.length) <= difficulty) {
      return encoded + '~S';
    }
  }
  return null;
}

// ── Generate requirements proof (gAAAAAC, trivial difficulty "0") ───────

function generateRequirementsProof(userAgent, sid) {
  const fingerprint = buildFingerprint(userAgent, sid);
  const reqSeed = '' + Math.random();
  const answer = solvePoW(reqSeed, '0', fingerprint);
  if (answer) return 'gAAAAAC' + answer;
  // Fallback: just encode without PoW
  fingerprint[3] = 1;
  fingerprint[9] = 0;
  return 'gAAAAAC' + encodeProof(fingerprint);
}

// ── Fetch challenge from sentinel.openai.com/backend-api/sentinel/req ───

async function fetchChallenge(proxyUrl, userAgent, flow, sentinelId, cycleTLSFn) {
  const proof = generateRequirementsProof(userAgent, sentinelId);

  // Prefer CycleTLS if provided (matches Chrome TLS fingerprint of register request)
  if (cycleTLSFn) {
    try {
      const url = SENTINEL_BASE + 'req';
      const res = await cycleTLSFn(url, {
        body: JSON.stringify({ p: proof, id: sentinelId, flow }),
        ja3: CHROME_JA3,
        http2Fingerprint: CHROME_H2,
        userAgent: CHROME_UA,
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Origin': 'https://chatgpt.com',
          'Referer': FRAME_REFERER,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 30,
        proxy: proxyUrl || undefined,
      }, 'post');

      if (res.status !== 200) {
        // CycleTLS uses .data (parsed) not .body
        const resBody = res.data || (typeof res.json === 'function' ? await res.json().catch(() => null) : null);
        logger.info(`Sentinel/req failed (${res.status}): ${JSON.stringify(resBody).substring(0, 300)}`);
        return null;
      }

      // CycleTLS response: .data (parsed object) or .json() (async parsed)
      let data = res.data;
      if (!data && typeof res.json === 'function') {
        data = await res.json().catch(() => null);
      }
      if (!data) {
        logger.info(`Sentinel/req 200 but no data (keys=${Object.keys(res).join(',')})`);
        return null;
      }
      return { challenge: data, reqProof: proof };
    } catch (e) {
      logger.info(`Sentinel/req CycleTLS error: ${e.message}`);
      // Fall through to axios
    }
  } else {
    logger.info('Sentinel/req: no CycleTLS fn provided, using axios fallback');
  }

  // Fallback: axios (plain Node.js TLS — less ideal)
  const config = {
    method: 'POST',
    url: SENTINEL_BASE + 'req',
    data: JSON.stringify({ p: proof, id: sentinelId, flow }),
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Origin': 'https://chatgpt.com',
      'Referer': FRAME_REFERER,
      'User-Agent': userAgent,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 30000,
    validateStatus: () => true,
  };

  if (proxyUrl) {
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
  }

  const res = await axios(config);

  if (res.status !== 200) {
    logger.info(`Sentinel/req failed via axios (${res.status}): ${JSON.stringify(res.data).substring(0, 200)}`);
    return null;
  }

  return { challenge: res.data, reqProof: proof };
}

// ── Main: generate sentinel tokens for a flow ───────────────────────────

async function generateSentinelTokens(proxyUrl, userAgent, flow, sentinelId, cycleTLSFn) {
  // Always use Chrome 147 UA to match CycleTLS register request fingerprint.
  // If caller passes a different/empty UA, override it.
  const ua = CHROME_UA;

  // 1. Get challenge from server (prefer CycleTLS for matching TLS fingerprint)
  const fetchResult = await fetchChallenge(proxyUrl, ua, flow, sentinelId, cycleTLSFn);
  if (!fetchResult) {
    logger.info('Sentinel challenge fetch failed — no challenge data');
    return { sentinelToken: null, soToken: null };
  }
  const { challenge, reqProof } = fetchResult;

  // Log challenge structure for debugging
  const pow = challenge.proofofwork?.required ? `d=${challenge.proofofwork.difficulty}` : 'no';
  const tx = challenge.turnstile?.required ? `${challenge.turnstile.dx?.length || 0}ch` : 'no';
  const so = challenge.so?.required ? 'yes' : 'no';

  // 2. Solve proof-of-work
  const fingerprint = buildFingerprint(ua, sentinelId);
  let proofAnswer = null;

  if (challenge.proofofwork?.required) {
    const { seed, difficulty } = challenge.proofofwork;
    if (typeof seed === 'string' && typeof difficulty === 'string') {
      proofAnswer = solvePoW(seed, difficulty, fingerprint);
    }
  }

  let proof;
  if (proofAnswer) {
    proof = 'gAAAAAB' + proofAnswer;
  } else {
    // Fallback: encode fingerprint without solved PoW
    fingerprint[3] = 1;
    fingerprint[9] = 0;
    proof = 'gAAAAAB' + encodeProof(fingerprint);
    logger.info(`PoW fallback (no solution)`);
  }

  // 3. Solve turnstile.dx via VM (generates the 't' field)
  let turnstileResult = null;
  if (challenge.turnstile?.required && challenge.turnstile?.dx) {
    try {
      const sdkUrl = `https://sentinel.openai.com/sentinel/${SENTINEL_VERSION}/sdk.js`;
      // XOR key must be the requirements proof sent to server (gAAAAAC...),
      // NOT the PoW answer proof (gAAAAAB...) — server encrypted dx with reqProof
      turnstileResult = await solveTurnstileDx(
        challenge.turnstile.dx, reqProof, ua,
        sentinelId, sdkUrl
      );
    } catch (e) {
      logger.info(`Turnstile VM error: ${e.message}`);
    }
  }

  // 4. Build openai-sentinel-token
  const tokenPayload = {
    p: proof,
    t: turnstileResult || null,
    c: challenge.token || null,
    id: sentinelId,
    flow,
  };
  logger.info(`Token ✓`);
  const sentinelToken = JSON.stringify(tokenPayload);

  // 5. Build openai-sentinel-so-token (if SO data available)
  let soToken = null;
  if (challenge.token) {
    // SO token uses same challenge token but different data
    // Without real browser SO collection, send minimal data
    soToken = JSON.stringify({
      so: null,
      c: challenge.token,
      id: sentinelId,
      flow,
    });
  }

  return { sentinelToken, soToken };
}

module.exports = { generateSentinelTokens, fnv1aHash, solvePoW, encodeProof };
