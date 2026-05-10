/**
 * Stripe Trial Link Generator — Non-interactive module
 *
 * Extracted from get-trial-link.js for programmatic use.
 * Auto-detects country via OpenAI API, falls back to env/config.
 */

const https = require('https');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const BASE = 'https://chatgpt.com';
const COUPON = 'plus-1-month-free';

const CURRENCY_MAP = {
  ID: 'IDR', VN: 'VND', US: 'USD', GB: 'GBP', UK: 'GBP',
  JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', TH: 'THB',
  PH: 'PHP', IN: 'INR', AU: 'AUD', NZ: 'NZD', CA: 'CAD',
  BR: 'BRL', MX: 'MXN', DE: 'EUR', FR: 'EUR', IT: 'EUR',
  ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR',
  IE: 'EUR', FI: 'EUR', GR: 'EUR', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON',
  CH: 'CHF', TR: 'TRY', ZA: 'ZAR', AE: 'AED', SA: 'SAR',
  TW: 'TWD', HK: 'HKD', CN: 'CNY', RU: 'RUB', AR: 'ARS',
  CL: 'CLP', CO: 'COP', PE: 'PEN', NG: 'NGN', KE: 'KES',
  EG: 'EGP', PK: 'PKR', BD: 'BDT', IL: 'ILS', UA: 'UAH',
};

function makeAgent(proxyUrl) {
  if (!proxyUrl) return null;
  let url = proxyUrl;
  if (!url.includes('://')) url = 'http://' + url;
  return url.startsWith('socks')
    ? new SocksProxyAgent(url)
    : new HttpsProxyAgent(url);
}

function pFetch(url, opts = {}, agent) {
  if (!agent) return fetch(url, opts);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...opts.headers },
      agent,
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({
        status: res.statusCode,
        json: () => JSON.parse(data),
        text: () => data,
      }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Get Stripe trial payment link for a ChatGPT account
 *
 * @param {string} accessToken - Bearer token from /api/auth/session
 * @param {string|null} proxyUrl - HTTP/SOCKS proxy URL or null
 * @param {string} [fallbackCountry='ID'] - Country code fallback
 * @returns {Promise<{success: boolean, url?: string, error?: string, state?: string}>}
 */
async function getTrialLink(accessToken, proxyUrl, fallbackCountry = 'ID') {
  const agent = makeAgent(proxyUrl);

  const h = {
    'accept': '*/*',
    'authorization': 'Bearer ' + accessToken,
    'content-type': 'application/json',
    'oai-device-id': crypto.randomUUID(),
    'oai-language': 'en-US',
    'user-agent': UA,
    'referer': BASE + '/?promo_campaign=' + COUPON,
  };

  // 1. Detect country
  let country = fallbackCountry;
  let currency = CURRENCY_MAP[country] || 'USD';
  try {
    const countriesRes = await pFetch(
      BASE + '/backend-api/checkout_pricing_config/countries',
      { headers: h },
      agent,
    ).then(r => r.json());

    const detected = countriesRes.default_country || countriesRes.selected_country || '';
    const detectedCurrency = countriesRes.default_currency || '';
    if (detected) {
      country = detected;
      currency = detectedCurrency || CURRENCY_MAP[country] || 'USD';
    }
  } catch {}

  // 2. Check coupon
  let couponState;
  try {
    const couponRes = await pFetch(
      BASE + '/backend-api/promo_campaign/check_coupon?coupon=' + COUPON + '&is_coupon_from_query_param=true',
      { headers: h },
      agent,
    ).then(r => r.json());
    couponState = couponRes.state || 'unknown';
  } catch (e) {
    return { success: false, error: 'Coupon check failed: ' + e.message };
  }

  if (couponState !== 'eligible') {
    return { success: false, error: 'Coupon not eligible', state: couponState };
  }

  // 3. Get pricing config (required step)
  try {
    await pFetch(
      BASE + '/backend-api/checkout_pricing_config/configs/' + country,
      { headers: h },
      agent,
    );
  } catch {}

  // 4. Checkout → get URL
  try {
    const data = await pFetch(BASE + '/backend-api/payments/checkout', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        entry_point: 'all_plans_pricing_modal',
        plan_name: 'chatgptplusplan',
        billing_details: { country, currency },
        promo_campaign: {
          promo_campaign_id: COUPON,
          is_coupon_from_query_param: false,
        },
      }),
    }, agent).then(r => r.json());

    if (!data.checkout_session_id) {
      return { success: false, error: 'No checkout session: ' + JSON.stringify(data).substring(0, 200) };
    }

    if (!data.url) {
      return { success: false, error: 'No URL in checkout response' };
    }

    return { success: true, url: data.url };
  } catch (e) {
    return { success: false, error: 'Checkout failed: ' + e.message };
  }
}

module.exports = { getTrialLink };
