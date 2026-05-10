/**
 * GET TRIAL LINK - pay.openai.com (Trial)
 * 
 * Usage:
 *   node get-trial-link.js --proxy=192.168.1.77:60004
 *   node get-trial-link.js --proxy=socks5://192.168.1.77:60004
 */

const readline = require("readline");
const https = require("https");
const http = require("http");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

const proxyArg = process.argv.find(a => a.startsWith("--proxy="));
let proxyUrl = proxyArg ? proxyArg.split("=").slice(1).join("=") : null;
if (proxyUrl && !proxyUrl.includes("://")) proxyUrl = `http://${proxyUrl}`;
const agent = proxyUrl ? (proxyUrl.startsWith("socks") ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl)) : null;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const BASE = "https://chatgpt.com";
const COUPON = "plus-1-month-free";

const CURRENCY_MAP = {
  ID: "IDR", VN: "VND", US: "USD", GB: "GBP", UK: "GBP",
  JP: "JPY", KR: "KRW", SG: "SGD", MY: "MYR", TH: "THB",
  PH: "PHP", IN: "INR", AU: "AUD", NZ: "NZD", CA: "CAD",
  BR: "BRL", MX: "MXN", DE: "EUR", FR: "EUR", IT: "EUR",
  ES: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", PT: "EUR",
  IE: "EUR", FI: "EUR", GR: "EUR", SE: "SEK", NO: "NOK",
  DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON",
  CH: "CHF", TR: "TRY", ZA: "ZAR", AE: "AED", SA: "SAR",
  TW: "TWD", HK: "HKD", CN: "CNY", RU: "RUB", AR: "ARS",
  CL: "CLP", CO: "COP", PE: "PEN", NG: "NGN", KE: "KES",
  EG: "EGP", PK: "PKR", BD: "BDT", IL: "ILS", UA: "UAH",
};

function pFetch(url, opts = {}) {
  if (!agent) return fetch(url, opts);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: opts.method || "GET",
      headers: { ...opts.headers }, agent,
    }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve({ status: res.statusCode, json: () => JSON.parse(data), text: () => data }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim()); }));
}

(async () => {
  console.log("═".repeat(55));
  console.log("  💳 GET TRIAL LINK - pay.openai.com (Trial)");
  if (proxyUrl) console.log(`  🌐 Proxy: ${proxyUrl}`);
  console.log("═".repeat(55));

  const raw = await ask("\n📋 Paste full session JSON: ");
  let token;
  try { token = JSON.parse(raw).accessToken; } catch {
    const m = raw.match(/"accessToken"\s*:\s*"([^"]+)"/);
    token = m?.[1] || raw;
  }
  if (!token) { console.log("❌ Không tìm thấy accessToken!"); process.exit(1); }
  console.log(`\n🔑 Token: ${token.substring(0, 40)}...`);

  const h = {
    "accept": "*/*", "authorization": `Bearer ${token}`, "content-type": "application/json",
    "oai-device-id": crypto.randomUUID(), "oai-language": "en-US",
    "user-agent": UA, "referer": `${BASE}/?promo_campaign=${COUPON}`,
  };

  // 0. Detect country from OpenAI's own API (same as chatgpt.com)
  let detectedCountry = "", detectedCurrency = "";
  try {
    console.log(`\n🌍 Detecting country (checkout_pricing_config/countries)...`);
    const countriesRes = await pFetch(`${BASE}/backend-api/checkout_pricing_config/countries`, { headers: h }).then(r => r.json());
    detectedCountry = countriesRes.default_country || countriesRes.selected_country || "";
    detectedCurrency = countriesRes.default_currency || "";
    if (!detectedCountry && Array.isArray(countriesRes)) {
      // Response might be a list; log for debug
      console.log(`   → Response keys: ${JSON.stringify(Object.keys(countriesRes)).substring(0, 200)}`);
    }
    if (!detectedCountry && countriesRes && typeof countriesRes === "object") {
      // Try to find country in response
      const keys = Object.keys(countriesRes);
      console.log(`   → Response keys: ${keys.join(", ")}`);
      for (const k of keys) {
        const v = countriesRes[k];
        if (typeof v === "string" && v.length === 2 && v === v.toUpperCase()) {
          detectedCountry = v; break;
        }
      }
    }
    if (detectedCountry) console.log(`   → IP country: ${detectedCountry} ${detectedCurrency ? "/ " + detectedCurrency : ""}`);
    else console.log(`   → Response: ${JSON.stringify(countriesRes).substring(0, 300)}`);
  } catch (e) { console.log(`   → Failed: ${e.message}`); }

  const countryInput = (await ask(`🌍 Country code (2 chữ, Enter = ${detectedCountry || "US"}): `)).toUpperCase();
  const country = countryInput || detectedCountry || "US";
  const currency = detectedCurrency && !countryInput ? detectedCurrency : (CURRENCY_MAP[country] || "USD");
  console.log(`   → ${country} / ${currency}`);

  // 1. Check coupon
  console.log(`\n🎟️  Check coupon...`);
  const coupon = await pFetch(`${BASE}/backend-api/promo_campaign/check_coupon?coupon=${COUPON}&is_coupon_from_query_param=true`, { headers: h }).then(r => r.json());
  console.log(`   → ${coupon.state} ${coupon.state === "eligible" ? "✅" : "❌"}`);
  if (coupon.state !== "eligible") { console.log(`\n❌ Coupon không eligible! Dừng.`); process.exit(1); }

  // 2. Pricing config
  console.log(`💰 Pricing config (${country})...`);
  await pFetch(`${BASE}/backend-api/checkout_pricing_config/configs/${country}`, { headers: h });
  console.log(`   → ✅`);

  // 3. Checkout (hosted mode → returns url directly)
  console.log(`🛒 Checkout...`);
  const data = await pFetch(`${BASE}/backend-api/payments/checkout`, {
    method: "POST", headers: h,
    body: JSON.stringify({
      entry_point: "all_plans_pricing_modal", plan_name: "chatgptplusplan",
      billing_details: { country, currency },
      promo_campaign: { promo_campaign_id: COUPON, is_coupon_from_query_param: false },
    }),
  }).then(r => r.json());

  if (!data.checkout_session_id) {
    console.log(`   ❌ Failed:`, JSON.stringify(data).substring(0, 300));
    process.exit(1);
  }
  console.log(`   → ${data.checkout_session_id}`);
  console.log(`   → Mode: ${data.checkout_ui_mode} | Tax: ${data.automatic_tax_enabled}`);

  if (!data.url) {
    console.log(`   ❌ No URL in response!`);
    console.log(`   → Keys: ${Object.keys(data).join(", ")}`);
    process.exit(1);
  }

  // OUTPUT
  console.log("\n" + "═".repeat(55));
  console.log("  🎉 PAY LINK:");
  console.log("═".repeat(55));
  console.log(`\n${data.url}\n`);
  console.log("═".repeat(55));
})();
