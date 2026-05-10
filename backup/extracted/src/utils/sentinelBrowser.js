/**
 * Hybrid Sentinel Token Generator — uses a headless browser to run
 * OpenAI's Sentinel SDK (including Cloudflare Turnstile challenge).
 * 
 * The browser creates a minimal page on the auth.openai.com origin,
 * loads the SentinelSDK, and calls token() + sessionObserverToken().
 * The VM inside the SDK executes the Turnstile challenge in a real
 * browser environment, producing valid tokens.
 * 
 * This browser instance can be reused across multiple signups.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');

puppeteer.use(StealthPlugin());

const SENTINEL_SDK_URL = 'https://sentinel.openai.com/backend-api/sentinel/sdk.js';
const CHATGPT_ORIGIN = 'https://chatgpt.com';
const AUTH_ORIGIN = 'https://auth.openai.com';

// Must match CHROME_UA in apiSignup.js so sentinel fingerprint aligns with
// CycleTLS register request UA. Headless Chrome reports "HeadlessChrome"
// by default, which causes a sentinel-vs-register UA mismatch → 400.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

let browserInstance = null;
let browserPage = null;
let sdkReady = false;
let browserProxyUrl = null; // Track which proxy the browser was launched with

// Queue for serializing concurrent token requests
let tokenQueue = Promise.resolve();

/**
 * Launch (or reuse) a headless browser with the Sentinel SDK loaded.
 * The page is set to auth.openai.com origin so cookies/CORS work.
 */
async function ensureBrowser(proxyUrl) {
  // If proxy changed, kill the old browser so we get a fresh one with the new IP
  if (browserInstance && proxyUrl !== browserProxyUrl) {
    logger.debug(`Sentinel browser: proxy changed (${browserProxyUrl?.substring(0, 30)} → ${proxyUrl?.substring(0, 30)}), restarting...`);
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    browserPage = null;
    sdkReady = false;
    browserProxyUrl = null;
  }

  if (browserInstance && browserPage) {
    try {
      // Check if browser is still alive
      await browserPage.evaluate(() => true);
      return;
    } catch {
      // Browser died, re-launch
      browserInstance = null;
      browserPage = null;
      sdkReady = false;
      browserProxyUrl = null;
    }
  }

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--window-size=800,600',
  ];

  if (proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      args.push(`--proxy-server=${url.hostname}:${url.port}`);
    } catch {}
  }

  browserInstance = await puppeteer.launch({
    headless: 'new',
    args,
  });

  browserPage = await browserInstance.newPage();

  // Override UA so it matches CycleTLS register UA (Chrome, not HeadlessChrome)
  await browserPage.setUserAgent(CHROME_UA);

  // Also override navigator.webdriver + userAgentData to avoid sentinel detecting headless
  await browserPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Set proxy auth if needed
  if (proxyUrl) {
    try {
      const url = new URL(proxyUrl);
      if (url.username) {
        await browserPage.authenticate({
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        });
      }
    } catch {}
  }

  // Navigate to auth.openai.com origin so sentinel SDK generates token
  // matching the Origin header of the register request.
  // The path must return a real HTML page (not 404) so SDK has a proper
  // document context (document.title, page URL, React container, etc.)
  // Sentinel inspects these — a blank/404 page is detected as non-real.
  await browserPage.goto(`${AUTH_ORIGIN}/log-in`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  if (process.env.DEBUG_SENTINEL_BROWSER) {
    try {
      const info = await browserPage.evaluate(() => ({
        ua: navigator.userAgent,
        origin: location.origin,
        href: location.href,
        webdriver: navigator.webdriver,
      }));
      logger.info(`[sentinel-browser] page: ${JSON.stringify(info)}`);
    } catch {}
  }

  // Inject the Sentinel SDK
  await browserPage.evaluate((sdkUrl) => {
    return new Promise((resolve, reject) => {
      // Set up pending arrays before loading SDK
      window.__sentinel_token_pending = [];
      window.__sentinel_init_pending = [];

      const script = document.createElement('script');
      script.src = sdkUrl;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Sentinel SDK'));
      document.head.appendChild(script);
    });
  }, SENTINEL_SDK_URL);

  // Wait for SentinelSDK to be available
  await browserPage.waitForFunction(
    () => window.SentinelSDK && typeof window.SentinelSDK.token === 'function',
    { timeout: 15000 }
  );

  sdkReady = true;
  browserProxyUrl = proxyUrl; // Track which proxy this browser uses
  logger.debug('Sentinel browser: SDK loaded and ready');
}

/**
 * Generate sentinel + session observer tokens using the browser SDK.
 * Queued so only one token generation runs at a time.
 * 
 * @param {string|null} proxyUrl — proxy for the browser
 * @param {string} flow — sentinel flow (e.g. 'username_password_create')
 * @param {Array} [cookies] — cookies to inject before generating token
 *   Array of {name, value, domain} objects from CycleTLS CookieJar
 * @returns {{ sentinelToken: string|null, soToken: string|null }}
 */
async function generateSentinelTokensBrowser(proxyUrl, flow, cookies) {
  // Queue requests — browser can only handle one at a time
  const result = new Promise((resolve, reject) => {
    tokenQueue = tokenQueue.then(async () => {
      try {
        const r = await _generateTokensInternal(proxyUrl, flow, cookies);
        resolve(r);
      } catch (e) {
        reject(e);
      }
    });
  });
  return result;
}

/** Race a promise against a timeout */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms / 1000}s)`)), ms)
    ),
  ]);
}

async function _generateTokensInternal(proxyUrl, flow, cookies) {
  await ensureBrowser(proxyUrl);

  // Clear stale cookies from previous attempts, then inject fresh ones
  if (Array.isArray(cookies) && cookies.length > 0) {
    try {
      // Delete all existing cookies first to prevent contamination from old sessions
      const existingCookies = await browserPage.cookies();
      if (existingCookies.length > 0) {
        await browserPage.deleteCookie(...existingCookies);
        logger.debug(`Sentinel browser: cleared ${existingCookies.length} old cookies`);
      }
      const puppeteerCookies = cookies
        .filter(c => c.name && c.value)
        .map(c => ({
          name: c.name,
          value: c.value,
          domain: (c.domain || 'chatgpt.com').replace(/^\./, ''),
          path: '/',
        }));
      if (puppeteerCookies.length > 0) {
        await browserPage.setCookie(...puppeteerCookies);
        logger.debug(`Sentinel browser: injected ${puppeteerCookies.length} fresh cookies`);
      }
    } catch (e) {
      logger.debug(`Sentinel browser: cookie injection failed: ${e.message}`);
    }
  }

  try {
    // Initialize the flow (30s timeout)
    await withTimeout(
      browserPage.evaluate(async (flow) => {
        if (window.SentinelSDK.init) {
          await window.SentinelSDK.init(flow);
        }
      }, flow),
      30000,
      'Sentinel init'
    );

    logger.debug(`Sentinel browser: init(${flow}) done`);

    // Get the sentinel token — triggers Turnstile challenge (30s timeout)
    const sentinelToken = await withTimeout(
      browserPage.evaluate(async (flow) => {
        try {
          return await window.SentinelSDK.token(flow);
        } catch (e) {
          return null;
        }
      }, flow),
      30000,
      'Sentinel token'
    );

    logger.debug(`Sentinel browser: token() = ${sentinelToken ? sentinelToken.length + ' chars' : 'null'}`);

    if (sentinelToken) {
      try {
        const parsed = JSON.parse(sentinelToken);
        logger.debug(`Sentinel: ${parsed.flow} (${sentinelToken.length}ch)`);
      } catch {
        logger.debug(`Sentinel: not JSON (${sentinelToken.substring(0, 30)}...)`);
      }
    }
    // If token is null, force browser restart for next attempt
    if (!sentinelToken) {
      logger.debug('Sentinel browser: token null — killing browser for fresh start');
      try { await browserInstance.close(); } catch {}
      browserInstance = null;
      browserPage = null;
      sdkReady = false;
      browserProxyUrl = null;
      return { sentinelToken: null, soToken: null };
    }

    // Get the session observer token (15s timeout, non-critical)
    let soToken = null;
    try {
      soToken = await withTimeout(
        browserPage.evaluate(async (flow) => {
          try {
            if (window.SentinelSDK.sessionObserverToken) {
              return await window.SentinelSDK.sessionObserverToken(flow);
            }
            return null;
          } catch (e) {
            return null;
          }
        }, flow),
        15000,
        'Sentinel soToken'
      );
    } catch {
      // soToken is optional — don't fail the whole thing
    }

    logger.debug(`Sentinel browser: soToken() = ${soToken ? soToken.length + ' chars' : 'null'}`);

    return { sentinelToken, soToken };
  } catch (e) {
    logger.debug(`Sentinel browser error: ${e.message}`);
    // Kill and restart browser on any error
    logger.debug('Sentinel browser: restarting due to error...');
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
    browserPage = null;
    sdkReady = false;
    browserProxyUrl = null;
    return { sentinelToken: null, soToken: null };
  }
}

/**
 * Close the browser instance.
 */
async function closeSentinelBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
    browserPage = null;
    sdkReady = false;
    browserProxyUrl = null;
  }
}

module.exports = { generateSentinelTokensBrowser, closeSentinelBrowser };
