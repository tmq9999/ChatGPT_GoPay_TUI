/**
 * Trace the password-add flow step by step using a real accessToken.
 * Run: node trace_password_flow.js
 */
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');

async function main() {
  const initCycleTLS = require('cycletls');
  const tls = await initCycleTLS();

  // Read latest account
  const wb = XLSX.readFile('Account_ChatGPT_Data.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws);
  const latest = data[data.length - 1];
  const sess = JSON.parse(latest['Full Session'] || '{}');
  const accessToken = sess.accessToken;
  const email = latest.Email;

  console.log('Using:', email);
  console.log('AccessToken:', accessToken?.substring(0, 60) + '...');

  const BASE = 'https://chatgpt.com';
  const AUTH_BASE = 'https://auth.openai.com';
  const deviceId = uuidv4();
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  const cookieJar = {};
  function cookieStr(url) {
    const domain = new URL(url).hostname;
    return Object.entries(cookieJar)
      .filter(([k]) => domain.includes(k) || k.includes(domain))
      .map(([, v]) => Object.entries(v).map(([n, val]) => n + '=' + val).join('; '))
      .join('; ');
  }
  function captureCookies(headers, url) {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const sc = headers?.['Set-Cookie'] || headers?.['set-cookie'];
    if (!sc) return;
    const arr = Array.isArray(sc) ? sc : [sc];
    if (!cookieJar[domain]) cookieJar[domain] = {};
    for (const c of arr) {
      const m = c.match(/^([^=]+)=([^;]*)/);
      if (m) cookieJar[domain][m[1]] = m[2];
    }
  }

  async function req(method, url, body, extraHeaders = {}) {
    const opts = {
      ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0',
      userAgent: UA,
      timeout: 30,
      headers: {
        Cookie: cookieStr(url),
        ...extraHeaders,
      },
    };
    if (body) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await tls(url, opts, method);
    captureCookies(res.headers, url);
    return res;
  }

  // ── Step 1: Init chatgpt.com with session ──
  console.log('\n── Step 1: GET chatgpt.com/ ──');
  cookieJar['chatgpt.com'] = { 'oai-did': deviceId };
  const initRes = await req('get', BASE + '/');
  console.log('Status:', initRes.status);

  // ── Step 2: CSRF ──
  console.log('\n── Step 2: GET /api/auth/csrf ──');
  const csrfRes = await req('get', BASE + '/api/auth/csrf', null, { Referer: BASE + '/' });
  let csrfData;
  try { csrfData = typeof csrfRes.data === 'string' ? JSON.parse(csrfRes.data) : csrfRes.data; } catch { csrfData = {}; }
  console.log('CSRF:', csrfData?.csrfToken?.substring(0, 30));

  // ── Step 3: POST signin with post_login_add_password ──
  console.log('\n── Step 3: POST signin (add password) ──');
  const signinQuery = new URLSearchParams({
    connection: 'password',
    login_hint: email,
    reauth: 'password',
    post_login_add_password: 'true',
    max_age: '0',
    'ext-oai-did': deviceId,
  }).toString();
  const signinBody = new URLSearchParams({
    callbackUrl: BASE + '/',
    csrfToken: csrfData?.csrfToken || '',
    json: 'true',
  }).toString();
  const signinRes = await req('post', BASE + '/api/auth/signin/openai?' + signinQuery, signinBody, {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: BASE,
    Referer: BASE + '/',
  });
  let signinData;
  try { signinData = typeof signinRes.data === 'string' ? JSON.parse(signinRes.data) : signinRes.data; } catch { signinData = {}; }
  console.log('Signin status:', signinRes.status);
  console.log('Authorize URL:', signinData?.url?.substring(0, 120));

  if (!signinData?.url) {
    console.log('No URL, stopping.');
    await tls.exit();
    return;
  }

  // ── Step 4: Follow redirects ──
  console.log('\n── Step 4: Follow redirects ──');
  let currentUrl = signinData.url;
  for (let i = 0; i < 15; i++) {
    console.log('  → [' + (i+1) + '] ' + currentUrl.substring(0, 100));
    const rr = await req('get', currentUrl, null, {
      Accept: 'text/html,application/xhtml+xml',
      Referer: i === 0 ? BASE + '/' : currentUrl,
    });
    console.log('    ← ' + rr.status);
    let loc = rr.headers?.['Location'] || rr.headers?.['location'];
    if (Array.isArray(loc)) loc = loc[0];
    if (rr.status >= 300 && rr.status < 400 && loc) {
      currentUrl = new URL(loc, currentUrl).href;
    } else {
      console.log('  Final URL:', currentUrl.substring(0, 120));
      break;
    }
  }

  // ── Step 5: client_auth_session_dump ──
  console.log('\n── Step 5: GET client_auth_session_dump ──');
  const dumpRes = await req('get', AUTH_BASE + '/api/accounts/client_auth_session_dump', null, {
    Referer: AUTH_BASE + '/email-verification',
  });
  console.log('Status:', dumpRes.status);
  let dumpData;
  try { dumpData = typeof dumpRes.data === 'string' ? JSON.parse(dumpRes.data) : dumpRes.data; } catch { dumpData = dumpRes.data; }
  console.log('Dump keys:', typeof dumpData === 'object' ? Object.keys(dumpData) : String(dumpData).substring(0, 200));

  // ── Step 6: Try email-otp/validate with dummy code (to see what happens) ──
  console.log('\n── Step 6: POST email-otp/validate (code=000000 - test) ──');
  const otpTestRes = await req('post', AUTH_BASE + '/api/accounts/email-otp/validate', { code: '000000' }, {
    'Content-Type': 'application/json',
    Origin: AUTH_BASE,
    Referer: AUTH_BASE + '/email-verification',
  });
  console.log('Status:', otpTestRes.status);
  let otpTestData;
  try { otpTestData = typeof otpTestRes.data === 'string' ? JSON.parse(otpTestRes.data) : otpTestRes.data; } catch { otpTestData = otpTestRes.data; }
  console.log('Response:', JSON.stringify(otpTestData).substring(0, 300));

  // ── Step 7: Try password/add directly (skip OTP) ──
  console.log('\n── Step 7: POST password/add (direct) ──');
  const pwRes = await req('post', AUTH_BASE + '/api/accounts/password/add', { password: 'ZxcvZxcv@123.' }, {
    'Content-Type': 'application/json',
    Origin: AUTH_BASE,
    Referer: AUTH_BASE + '/reset-password/new-password',
  });
  console.log('Status:', pwRes.status);
  let pwData;
  try { pwData = typeof pwRes.data === 'string' ? JSON.parse(pwRes.data) : pwRes.data; } catch { pwData = pwRes.data; }
  console.log('Response:', JSON.stringify(pwData).substring(0, 300));

  await tls.exit();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
