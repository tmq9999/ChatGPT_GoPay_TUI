require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');
const ChatGPTSignup = require('./signup');
const ChatGPTAutopay = require('./autopay');
const { unlinkOpenAIFromGoPay } = require('./utils/gopayUnlink');
const { generateEmail, generateRandomBirthday, createAkbarMailbox } = require('./utils/emailGenerator');
const { buildProxyUrl } = require('./utils/httpClient');
const { listMuMuInstances, launchMuMuInstance, connectMuMuAdb, waitForWhatsAppOtpFromMuMu } = require('./utils/mumuOtp');
const initCycleTLS = require('cycletls');
const logger = require('./utils/logger');

let sharedCycleTLS = null;

const password = process.env.PASSWORD || 'Masuk12345@@';
const clientId = 'app_X8zY6vW2pQ9tR3dE7nK1jL5gH';
const redirectUri = 'https://chatgpt.com/api/auth/callback/openai';
const audience = 'https://api.openai.com/v1';

const emailDomains = (process.env.TMAIL_DOMAIN || 'newssolor.com').split(',').map(a => a.trim()).filter(Boolean);
const geDomains = (process.env.GE_DOMAIN || 'generator.email').split(',').map(a => a.trim()).filter(Boolean);
const emailServiceDomain = process.env.EMAIL_SERVICE_DOMAIN;
const emailServiceApiKey = process.env.EMAIL_SERVICE_API_KEY;
const akbarDomain = process.env.AKBAR_DOMAIN || '';

async function fetchAkbarDomains() {
    try {
        const base = (emailServiceDomain || 'https://mail.akbarstore.biz.id').replace(/\/$/, '');
        const res = await axios.get(base + '/api/domains', { timeout: 8000 });
        if (res.data && Array.isArray(res.data.domains)) {
            return { domains: res.data.domains, defaultDomain: res.data.default || res.data.domains[0] };
        }
    } catch (e) {}
    return { domains: [], defaultDomain: '' };
}

function pickRandom(a) {
    return a[Math.floor(Math.random() * a.length)];
}

const proxyUser = process.env.PROXY_USER || '';
const proxyPass = process.env.PROXY_PASS || '';
const proxyHost = process.env.PROXY_HOST || 'gw.dataimpulse.com';
const proxyPort = process.env.PROXY_PORT || '823';
const gopayPhone = process.env.GOPAY_PHONE || '';
const gopayPin = process.env.GOPAY_PIN || '';
const retries = parseInt(process.env.RETRIES) || 11;
const signupRetries = retries;
const loginRetries = retries;
const loginUseProxy = (process.env.LOGIN_USE_PROXY || 'false').toLowerCase() !== 'false';

const COUNTRY_LIST = [
    { code: 'id', name: 'Indonesia' },
    { code: 'us', name: 'United States' },
    { code: 'gb', name: 'United Kingdom' },
    { code: 'nl', name: 'Netherlands' },
    { code: 'de', name: 'Germany' },
    { code: 'fr', name: 'France' },
    { code: 'kr', name: 'South Korea' },
    { code: 'sg', name: 'Singapore' },
];

let signupUseProxy = false;

function getUserInput(a) {
    const b = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(c => b.question('\x1b[35m' + a + '\x1b[0m', d => {
        b.close();
        c(d.trim());
    }));
}

function buildOtpLink(a, b) {
    if (b === '2' || b === 'generator.email') {
        return 'generator.email/' + a;
    }
    const c = (emailServiceDomain || '').replace(/^https?:\/\//, '');
    return c + '/mailbox/' + a;
}

function saveToAccountsFile(a, b) {
    const c = path.join(__dirname, '..', 'accounts.txt');
    fs.appendFileSync(c, a + ':' + b + '\n');
}

function autoDetectMuMu() {
    const neteaseBases = [
        'C:\\Program Files\\Netease',
        'C:\\Program Files (x86)\\Netease',
    ];
    const managerSuffixes = ['\\nx_main\\MuMuManager.exe'];
    const adbSuffixes = [
        '\\nx_device\\12.0\\shell\\adb.exe',
        '\\nx_device\\shell\\adb.exe',
    ];
    for (const base of neteaseBases) {
        if (!fs.existsSync(base)) continue;
        let subDirs;
        try { subDirs = fs.readdirSync(base); } catch { continue; }
        // Sort so versioned folders (MuMuPlayer-12.0) come before unversioned
        subDirs.sort((a, b) => b.localeCompare(a));
        for (const sub of subDirs) {
            if (!sub.toLowerCase().includes('mumu')) continue;
            const dir = base + '\\' + sub;
            for (const ms of managerSuffixes) {
                const manager = dir + ms;
                if (!fs.existsSync(manager)) continue;
                for (const as of adbSuffixes) {
                    const adb = dir + as;
                    if (fs.existsSync(adb)) return { manager, adb };
                }
                // adb tidak ketemu, skip
            }
        }
    }
    return null;
}

function updateEnvFile(updates) {
    const envPath = path.join(__dirname, '..', '.env');
    let content = '';
    try { content = fs.readFileSync(envPath, 'utf8'); } catch { return; }
    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp('^(' + key + '=)(.*)$', 'm');
        if (regex.test(content)) {
            content = content.replace(regex, '$1' + value);
        }
    }
    fs.writeFileSync(envPath, content, 'utf8');
}

async function checkPublicIP(a) {
    const { createClient: b } = require('./utils/httpClient');
    try {
        const { client: c } = b(null);
        const d = await c.get('https://api.ipify.org?format=json', { timeout: 10000 });
        const e = d.data.ip || d.data;
        logger.info('Real IP: ' + e);
        if (a) {
            const { client: f } = b(a);
            const g = await f.get('https://api.ipify.org?format=json', { timeout: 15000 });
            const h = g.data.ip || g.data;
            if (h === e) {
                logger.error('Proxy NOT working! Proxy IP same as real IP: ' + h);
                logger.error('Check PROXY_USER / PROXY_PASS in .env or proxy balance!');
                process.exit(1);
            }
            logger.success('Proxy IP: ' + h + ' \u2713 (proxy is working)');
        }
    } catch (i) {
        logger.error('IP check failed: ' + i.message);
        if (a) {
            logger.error('Proxy connection failed! Check PROXY_USER/PROXY_PASS or proxy balance.');
            process.exit(1);
        }
    }
}

function parseOtpDigits(a) {
    return String(a || '').replace(/\D/g, '');
}

async function setupMuMuOtpBridge(a, b) {
    const c = (process.env.MUMU_MANAGER_PATH || '').trim();
    const d = (process.env.MUMU_ADB_PATH || '').trim();
    if (!c || !d) {
        throw new Error('Set MUMU_MANAGER_PATH and MUMU_ADB_PATH in .env first');
    }
    logger.info('MuMu: loading instance list...');
    let e = [];
    try {
        e = await listMuMuInstances(c);
    } catch (j) {
        logger.warn('MuMu list failed: ' + j.message);
    }
    let f = 0;
    if (e.length > 0) {
        console.log('\n' + a.cyan + 'MuMu Instances:' + a.reset);
        e.forEach(m => {
            console.log('  ' + a.yellow + m.index + '.' + a.reset + ' ' + m.name);
        });
        const k = e[0].index;
        const l = await getUserInput('Select MuMu instance index (default ' + k + '): ');
        f = l === '' ? k : parseInt(l, 10);
    } else {
        const m = await getUserInput('MuMu instance index not detected. Enter instance index (default 0): ');
        f = m === '' ? 0 : parseInt(m, 10);
    }
    if (Number.isNaN(f) || f < 0) {
        throw new Error('Invalid MuMu instance index');
    }
    logger.info('MuMu: launching instance ' + f + '...');
    await launchMuMuInstance(c, f);
    process.env.MUMU_SELECTED_INDEX = String(f);
    logger.info('MuMu: connecting ADB instance ' + f + '...');
    let g = null;
    const h = 5;
    for (let n = 1; n <= h; n++) {
        try {
            g = await connectMuMuAdb(d, null);
            break;
        } catch (o) {
            if (n < h) {
                logger.warn('MuMu ADB retry ' + n + '/' + h + ' \u2014 waiting 10s for instance to boot...');
                await new Promise(p => setTimeout(p, 10000));
            } else {
                throw o;
            }
        }
    }
    const i = parseOtpDigits('62' + b);
    logger.success('MuMu ready on ' + g);
    return {
        type: 'mumu',
        adbPath: d,
        deviceSerial: g,
        expectedPhone: i,
        timeoutMs: parseInt(process.env.MUMU_OTP_TIMEOUT_MS || '120000', 10),
        pollMs: parseInt(process.env.MUMU_OTP_POLL_MS || '2500', 10),
        seenOtps: new Set(),
    };
}

async function askOtpMode(a, b) {
    console.log(a.cyan + 'GoPay OTP Mode:' + a.reset);
    console.log('  ' + a.yellow + '1.' + a.reset + ' Manual input');
    console.log('  ' + a.yellow + '2.' + a.reset + ' Auto via MuMu ADB (WhatsApp notification)');
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    const c = await getUserInput('Select OTP mode (1/2): ');
    if (c === '2') {
        return setupMuMuOtpBridge(a, b);
    }
    return { type: 'manual' };
}

function createOtpInputFn(a, b) {
    if (!a || a.type !== 'mumu') {
        return null;
    }
    return async () => {
        logger.info('[#' + b + '] Waiting OTP from MuMu WhatsApp notification...');
        const c = await waitForWhatsAppOtpFromMuMu({
            adbPath: a.adbPath,
            deviceSerial: a.deviceSerial,
            expectedPhone: a.expectedPhone,
            timeoutMs: a.timeoutMs,
            pollMs: a.pollMs,
            initialDelayMs: 5000,
            seenOtps: a.seenOtps,
            onUpdate: d => {
                const e = Math.ceil(d / 1000);
                logger.info('[#' + b + '] Waiting OTP from MuMu... ' + e + 's left');
            },
        });
        logger.success('[#' + b + '] OTP captured from MuMu: ' + c);
        return c;
    };
}

async function runSingleSignup(a, b) {
    const c = pickRandom(b === '2' ? geDomains : emailDomains);
    const { email: d, name: e } = generateEmail(c);
    const f = generateRandomBirthday();
    let g = null;
    let h = '';
    if (signupUseProxy) {
        const k = pickRandom(COUNTRY_LIST);
        h = k.code;
        g = buildProxyUrl(h, proxyUser, proxyPass, proxyHost, proxyPort);
        logger.info('[#' + a + '] Proxy: ' + k.name + ' (' + k.code.toUpperCase() + ')');
    }
    console.log('\x1b[36m[#' + a + ']\x1b[0m \x1b[33m' + d + '\x1b[0m');
    const i = new ChatGPTSignup({
        email: d,
        password: password,
        name: e,
        birthdate: f.full,
        clientId: clientId,
        redirectUri: redirectUri,
        audience: audience,
        webmailProvider: b === '2' ? 'generator.email' : 'tmail',
        emailServiceDomain: emailServiceDomain,
        emailServiceApiKey: emailServiceApiKey,
        geDomain: c,
        proxyUrl: g,
        proxyConfig: h ? { country: h, user: proxyUser, pass: proxyPass, host: proxyHost, port: proxyPort } : null,
        threadId: a,
        signupRetries: signupRetries,
        sharedCycleTLS: sharedCycleTLS,
    });
    const j = await i.runSignup();
    if (j.success) {
        saveToAccountsFile(j.email, j.password);
        logger.success('[#' + a + '] Saved ' + j.email);
        return true;
    } else {
        logger.error('[#' + a + '] ' + j.error);
        return false;
    }
}

async function runSignupOnlyMode(a) {
    console.log('\n' + a.bold + a.green + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    console.log('' + a.bold + a.white + '  AUTO CREATE: Signup Only (Simpan ke accounts.txt)' + a.reset);
    console.log('' + a.bold + a.green + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset + '\n');

    // Domain
    let selectedDomain = akbarDomain;
    const { domains: availDomains, defaultDomain } = await fetchAkbarDomains();
    if (availDomains.length > 1) {
        console.log(a.cyan + 'Pilih Domain Email:' + a.reset);
        availDomains.forEach((d, i) => {
            const tag = d === defaultDomain ? a.gray + ' (default)' + a.reset : '';
            const sel = d === selectedDomain ? a.green + ' ✓' + a.reset : '';
            console.log('  ' + a.yellow + (i + 1) + '.' + a.reset + ' ' + d + tag + sel);
        });
        console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
        const defIdx = selectedDomain ? availDomains.indexOf(selectedDomain) + 1 : 1;
        const pick = await getUserInput('Pilih domain (default ' + defIdx + '): ');
        const idx = parseInt(pick) - 1;
        if (idx >= 0 && idx < availDomains.length) selectedDomain = availDomains[idx];
        else if (!selectedDomain) selectedDomain = defaultDomain;
    } else if (availDomains.length === 1) {
        selectedDomain = availDomains[0];
        logger.info('Domain: ' + selectedDomain);
    }

    const nInput = await getUserInput('Jumlah akun yang ingin dibuat: ');
    const n = parseInt(nInput);
    if (isNaN(n) || n <= 0) {
        logger.error('Jumlah tidak valid');
        process.exit(1);
    }

    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    console.log('  Mode     ' + a.green + 'Signup Only' + a.reset);
    console.log('  Akun     ' + a.yellow + n + a.reset);
    console.log('  Domain   ' + a.magenta + (selectedDomain || 'AkbarMail default') + a.reset);
    console.log('  Output   ' + a.green + 'accounts.txt' + a.reset);
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset + '\n');

    logger.info('Initializing TLS engine...');
    sharedCycleTLS = await initCycleTLS();
    logger.success('TLS engine ready');

    let ok = 0;
    for (let i = 1; i <= n; i++) {
        if (i > 1) {
            const w = Math.floor(Math.random() * 5) + 1;
            logger.info('Waiting ' + w + 's...');
            await new Promise(r => setTimeout(r, w * 1000));
        }
        console.log('\n' + a.bold + a.cyan + '\u2550\u2550\u2550 Account #' + i + '/' + n + ' \u2550\u2550\u2550' + a.reset + '\n');
        let email, name, akbarMailboxId = null;
        const mbx = await createAkbarMailbox(emailServiceDomain, selectedDomain);
        email = mbx.email; name = mbx.name; akbarMailboxId = mbx.mailboxId;
        const birthdate = generateRandomBirthday();
        console.log(a.cyan + '[#' + i + ']' + a.reset + ' ' + a.yellow + email + a.reset);
        const signup = new ChatGPTSignup({
            email,
            password,
            name,
            birthdate: birthdate.full,
            clientId,
            redirectUri,
            audience,
            webmailProvider: 'akbarmail',
            emailServiceDomain,
            emailServiceApiKey,
            akbarMailboxId,
            threadId: i,
            signupRetries,
            sharedCycleTLS,
        });
        const res = await signup.runSignup();
        if (res.success) {
            saveToAccountsFile(res.email, res.password);
            logger.success('[#' + i + '] ✓ ' + res.email + ' → accounts.txt');
            ok++;
        } else {
            logger.error('[#' + i + '] ' + res.error);
        }
    }

    try { await sharedCycleTLS.exit(); } catch {}
    sharedCycleTLS = null;

    console.log('\n' + a.cyan + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    console.log('' + a.bold + a.white + ' SIGNUP DONE' + a.reset + ' ' + a.green + ok + a.reset + '/' + a.yellow + n + a.reset + ' akun dibuat');
    console.log(a.cyan + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
}

async function runAutopayMode(a) {
    console.log('\n' + a.bold + a.green + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    console.log('' + a.bold + a.white + '  AUTOPAY: Signup + Pay Trial (GoPay)' + a.reset);
    console.log('' + a.bold + a.green + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset + '\n');
    if (!gopayPhone) {
        logger.error('GOPAY_PHONE required in .env (without +62, e.g. 85863369499)');
        process.exit(1);
    }
    if (!gopayPin || gopayPin.length !== 6) {
        logger.error('GOPAY_PIN required in .env (6-digit PIN)');
        process.exit(1);
    }
    const b = '3';
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    // Auto-select domain dari AkbarMail
    let selectedDomain = akbarDomain;
    const { domains: availDomains, defaultDomain } = await fetchAkbarDomains();
    if (availDomains.length > 1) {
        console.log(a.cyan + 'Pilih Domain Email:' + a.reset);
        availDomains.forEach((d, i) => {
            const tag = d === defaultDomain ? a.gray + ' (default)' + a.reset : '';
            const sel = d === selectedDomain ? a.green + ' ✓' + a.reset : '';
            console.log('  ' + a.yellow + (i + 1) + '.' + a.reset + ' ' + d + tag + sel);
        });
        console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
        const defIdx = selectedDomain ? availDomains.indexOf(selectedDomain) + 1 : 1;
        const pick = await getUserInput('Pilih domain (default ' + defIdx + '): ');
        const idx = parseInt(pick) - 1;
        if (idx >= 0 && idx < availDomains.length) selectedDomain = availDomains[idx];
        else if (!selectedDomain) selectedDomain = defaultDomain;
    } else if (availDomains.length === 1) {
        selectedDomain = availDomains[0];
        logger.info('Domain: ' + selectedDomain);
    }
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    const c = await askOtpMode(a, gopayPhone);
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    const d = b === '2' ? 'Generator.email' : b === '3' ? 'AkbarMail' : 'Tmail';
    const e = b === '2' ? geDomains : emailDomains;
    let f = 'sg';
    if (!proxyUser || !proxyPass) {
        logger.error('Proxy requires PROXY_USER and PROXY_PASS in .env');
        process.exit(1);
    }
    let g = buildProxyUrl(f, proxyUser, proxyPass, proxyHost, proxyPort);
    logger.success('Proxy: ' + proxyHost + ':' + proxyPort + ' (JP)');
    await checkPublicIP(g);
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    const h = await getUserInput('Enter number of accounts to create + pay: ');
    const j = parseInt(h);
    if (isNaN(j) || j <= 0) {
        logger.error('Invalid number');
        process.exit(1);
    }
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    console.log('  Mode      ' + a.green + 'Autopay (Signup+Pay)' + a.reset);
    console.log('  Accounts  ' + a.yellow + j + a.reset);
    console.log('  Provider  ' + a.green + d + a.reset);
    console.log('  Domain    ' + a.magenta + (selectedDomain || e.join(', ')) + a.reset);
    console.log('  GoPay     ' + a.green + '+62' + gopayPhone + a.reset);
    console.log('  OTP Mode  ' + (c.type === 'mumu' ? a.green + 'MuMu Auto' + a.reset : a.yellow + 'Manual' + a.reset));
    if (c.type === 'mumu') {
        console.log('  MuMu ADB  ' + a.green + c.deviceSerial + a.reset);
    }
    console.log('  PIN       ' + a.gray + '******' + a.reset);
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset + '\n');
    let k = 0;
    logger.info('Initializing TLS engine...');
    sharedCycleTLS = await initCycleTLS();
    logger.success('TLS engine ready');
    for (let l = 1; l <= j; l++) {
        if (l > 1) {
            const A = Math.floor(Math.random() * 10) + 1;
            logger.info('Waiting ' + A + 's before next account...');
            await new Promise(B => setTimeout(B, A * 1000));
        }
        console.log('\n' + a.bold + a.cyan + '\u2550\u2550\u2550 Account #' + l + '/' + j + ' \u2550\u2550\u2550' + a.reset + '\n');
        const m = pickRandom(b === '2' ? geDomains : emailDomains);
        let n, o, akbarMailboxId = null;
        if (b === '3') {
            const mbx = await createAkbarMailbox(emailServiceDomain, selectedDomain);
            n = mbx.email; o = mbx.name; akbarMailboxId = mbx.mailboxId;
        } else {
            const eg = generateEmail(m);
            n = eg.email; o = eg.name;
        }
        const p = generateRandomBirthday();
        console.log(a.cyan + '[#' + l + ']' + a.reset + ' ' + a.yellow + n + a.reset);
        const q = buildProxyUrl(f, proxyUser, proxyPass, proxyHost, proxyPort);
        logger.info('[#' + l + '] Phase 1: Creating account...');
        const r = new ChatGPTSignup({
            email: n,
            password: password,
            name: o,
            birthdate: p.full,
            clientId: clientId,
            redirectUri: redirectUri,
            audience: audience,
            webmailProvider: b === '2' ? 'generator.email' : b === '3' ? 'akbarmail' : 'tmail',
            emailServiceDomain: emailServiceDomain,
            emailServiceApiKey: emailServiceApiKey,
            geDomain: m,
            akbarMailboxId: akbarMailboxId,
            proxyUrl: q,
            proxyConfig: f ? { country: f, user: proxyUser, pass: proxyPass, host: proxyHost, port: proxyPort } : null,
            threadId: l,
            signupRetries: signupRetries,
            sharedCycleTLS: sharedCycleTLS,
        });
        const s = await r.runSignup();
        if (!s.success) {
            logger.error('[#' + l + '] Signup failed: ' + s.error);
            continue;
        }
        logger.success('[#' + l + '] Account created: ' + n);
        logger.info('[#' + l + '] Phase 2: Subscribing to ChatGPT Plus via GoPay...');
        const t = createOtpInputFn(c, l);
        const u = !!s.accessToken;
        if (u) {
            logger.success('[#' + l + '] Reusing signup session token \u2713');
        } else {
            logger.warn('[#' + l + '] No access token from signup, will do full login via SG proxy');
        }
        const v = q;
        const w = new ChatGPTAutopay({
            email: n,
            password: password,
            name: o,
            deviceId: r.deviceId,
            gopayPhone: gopayPhone,
            gopayPin: gopayPin,
            proxyUrl: q,
            loginProxyUrl: v,
            checkoutProxyUrl: q,
            threadId: l,
            webmailProvider: b === '2' ? 'generator.email' : b === '3' ? 'akbarmail' : 'tmail',
            emailServiceDomain: emailServiceDomain,
            emailServiceApiKey: emailServiceApiKey,
            akbarMailboxId: akbarMailboxId,
            geDomain: n.split('@')[1],
            sharedCycleTLS: sharedCycleTLS,
            accessToken: s.accessToken || null,
            skipLogin: u,
            otpInputFn: t,
            otpModeConfig: c,
        });
        let x = await w.runAutopay();
        let y = false;
        if (!x.success && x.gopayLinked && c.adbPath && c.deviceSerial) {
            logger.warn('[#' + l + '] GoPay linked but error occurred after \u2192 Auto-unlinking...');
            try {
                await unlinkOpenAIFromGoPay(c.adbPath, c.deviceSerial);
                logger.success('[#' + l + '] GoPay auto-unlinked \u2713');
                y = true;
            } catch (B) {
                logger.warn('[#' + l + '] GoPay auto-unlink failed: ' + B.message?.substring(0, 100));
            }
        }
        let z = 0;
        if (!x.success && !x.hint && !x.noRetry) {
            if (x.otpTimeout) z++;
            for (let D = 1; D <= loginRetries; D++) {
                if (z > 1) {
                    logger.warn('[#' + l + '] OTP not received after retry \u2014 skipping');
                    break;
                }
                logger.info('[#' + l + '] Rotating IP SG... (retry ' + D + '/' + loginRetries + ')');
                await new Promise(H => setTimeout(H, 3000));
                const E = buildProxyUrl(f, proxyUser, proxyPass, proxyHost, proxyPort);
                const F = E;
                const G = new ChatGPTAutopay({
                    email: n,
                    password: password,
                    name: o,
                    deviceId: r.deviceId,
                    gopayPhone: gopayPhone,
                    gopayPin: gopayPin,
                    proxyUrl: E,
                    loginProxyUrl: F,
                    checkoutProxyUrl: E,
                    threadId: l,
                    webmailProvider: b === '2' ? 'generator.email' : b === '3' ? 'akbarmail' : 'tmail',
                    emailServiceDomain: emailServiceDomain,
                    emailServiceApiKey: emailServiceApiKey,
                    akbarMailboxId: akbarMailboxId,
                    geDomain: n.split('@')[1],
                    sharedCycleTLS: sharedCycleTLS,
                    accessToken: s.accessToken || null,
                    skipLogin: u,
                    otpInputFn: t,
                    otpModeConfig: c,
                });
                x = await G.runAutopay();
                y = false;
                if (x.success || x.hint || x.noRetry) break;
                if (x.otpTimeout) {
                    z++;
                    if (z > 1) continue;
                }
                if (x.error) {
                    logger.error('[#' + l + '] ' + x.error.substring(0, 150));
                }
            }
        }
        if (x.success) {
            const H = path.join(__dirname, '..', 'accounts_plus.txt');
            fs.appendFileSync(H, n + ':' + password + '\n');
            logger.success('[#' + l + '] \u2713 ' + n + ' \u2192 ChatGPT Plus (saved to accounts_plus.txt)');
            k++;
        } else {
            if (x.gopayLinked && !y && c.adbPath && c.deviceSerial) {
                logger.warn('[#' + l + '] Final attempt: GoPay linked but error still occurred \u2192 Auto-unlinking...');
                try {
                    await unlinkOpenAIFromGoPay(c.adbPath, c.deviceSerial);
                    logger.success('[#' + l + '] GoPay auto-unlinked \u2713');
                } catch (I) {
                    logger.warn('[#' + l + '] GoPay auto-unlink failed: ' + I.message?.substring(0, 100));
                }
            }
            saveToAccountsFile(n, password);
            logger.error('[#' + l + '] Payment failed: ' + x.error + ' (account saved to accounts.txt)');
        }
    }
    console.log('\n' + a.cyan + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    console.log('' + a.bold + a.white + ' AUTOPAY DONE' + a.reset + ' ' + a.green + k + a.reset + '/' + a.yellow + j + a.reset + ' accounts + Plus');
    console.log(a.cyan + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
}

async function runLoginAutopayMode(a) {
    console.log('\n' + a.bold + a.green + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    console.log('' + a.bold + a.white + '  LOGIN + AUTOPAY (Existing Account)' + a.reset);
    console.log('' + a.bold + a.green + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset + '\n');
    if (!gopayPhone) {
        logger.error('GOPAY_PHONE required in .env (without +62, e.g. 85863369499)');
        process.exit(1);
    }
    if (!gopayPin || gopayPin.length !== 6) {
        logger.error('GOPAY_PIN required in .env (6-digit PIN)');
        process.exit(1);
    }
    console.log(a.cyan + 'Select Webmail Provider:' + a.reset);
    console.log('  ' + a.yellow + '1.' + a.reset + ' Tmail ' + a.gray + '(Default)' + a.reset);
    console.log('  ' + a.yellow + '2.' + a.reset + ' Generator.email');
    let b = await getUserInput('Enter choice (1/2): ');
    if (b !== '1' && b !== '2') { b = '1'; }
    if (b === '1' && (!emailServiceDomain || !emailServiceApiKey)) {
        logger.error('Tmail requires EMAIL_SERVICE_DOMAIN and EMAIL_SERVICE_API_KEY in .env');
        process.exit(1);
    }
    const c = await askOtpMode(a, gopayPhone);
    const d = b === '2' ? 'Generator.email' : 'Tmail';
    const e = path.join(__dirname, '..', 'accounts.txt');
    if (!fs.existsSync(e)) {
        logger.error('accounts.txt not found! Create accounts.txt with email:password per line.');
        process.exit(1);
    }
    const f = fs.readFileSync(e, 'utf-8')
        .split('\n')
        .map(k => k.split('|')[0].trim())
        .filter(k => k.includes(':'))
        .map(k => {
            const l = k.split(':');
            return { email: l[0].trim(), password: l.slice(1).join(':').trim() };
        });
    if (f.length === 0) {
        logger.error('No valid accounts in accounts.txt (format: email:password)');
        process.exit(1);
    }
    logger.info('Loaded ' + f.length + ' account(s) from accounts.txt');
    f.forEach((k, l) => console.log('  ' + a.gray + (l + 1) + '.' + a.reset + ' ' + k.email));
    let g = null;
    const h = 'sg';
    if (!proxyUser || !proxyPass) {
        logger.error('Proxy requires PROXY_USER and PROXY_PASS in .env');
        process.exit(1);
    }
    g = buildProxyUrl(h, proxyUser, proxyPass, proxyHost, proxyPort);
    logger.success('Proxy: ' + proxyHost + ':' + proxyPort + ' (JP)');
    await checkPublicIP(g);
    console.log('\n' + a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset);
    console.log('  Mode      ' + a.green + 'Login + Autopay' + a.reset);
    console.log('  Accounts  ' + a.yellow + f.length + a.reset);
    console.log('  Provider  ' + a.green + d + a.reset);
    console.log('  Retries   ' + a.yellow + loginRetries + a.reset);
    console.log('  Login     ' + a.green + 'Proxy' + a.reset + ' ' + a.gray + '(retry bergantian: Proxy/Direct)' + a.reset);
    console.log('  Checkout  ' + a.green + 'Proxy' + a.reset);
    console.log('  Country   ' + a.green + 'JP (Japan)' + a.reset);
    console.log('  GoPay     ' + a.green + '+62' + gopayPhone + a.reset);
    console.log('  OTP Mode  ' + (c.type === 'mumu' ? a.green + 'MuMu Auto' + a.reset : a.yellow + 'Manual' + a.reset));
    if (c.type === 'mumu') {
        console.log('  MuMu ADB  ' + a.green + c.deviceSerial + a.reset);
    }
    console.log('  PIN       ' + a.gray + '******' + a.reset);
    console.log(a.cyan + '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' + a.reset + '\n');
    let j = 0;
    logger.info('Initializing TLS engine...');
    sharedCycleTLS = await initCycleTLS();
    logger.success('TLS engine ready');
    for (let k = 0; k < f.length; k++) {
        if (k > 0) {
            const q = Math.floor(Math.random() * 10) + 1;
            logger.info('Waiting ' + q + 's before next account...');
            await new Promise(s => setTimeout(s, q * 1000));
        }
        const { email: l, password: m } = f[k];
        const n = k + 1;
        console.log('\n' + a.cyan + '[' + n + '/' + f.length + ']' + a.reset + ' ' + a.yellow + l + a.reset);
        let o = null;
        const p = loginRetries;
        for (let r = 0; r < p; r++) {
            if (r > 0) {
                logger.info('[' + n + '] Retry ' + r + '/' + (p - 1) + ' (IP baru)...');
                await new Promise(x => setTimeout(x, 3000));
            }
            const s = h ? buildProxyUrl(h, proxyUser, proxyPass, proxyHost, proxyPort) : null;
            const t = r % 2 === 0;
            const u = t ? s : null;
            logger.info('[' + n + '] Login route: ' + (t ? 'Proxy (SG)' : 'Direct (no proxy)'));
            const v = createOtpInputFn(c, n);
            const w = new ChatGPTAutopay({
                email: l,
                password: m,
                name: l.split('@')[0],
                gopayPhone: gopayPhone,
                gopayPin: gopayPin,
                proxyUrl: s,
                loginProxyUrl: u,
                checkoutProxyUrl: s,
                threadId: n,
                webmailProvider: b === '2' ? 'generator.email' : 'tmail',
                emailServiceDomain: emailServiceDomain,
                emailServiceApiKey: emailServiceApiKey,
                geDomain: l.split('@')[1],
                sharedCycleTLS: sharedCycleTLS,
                otpInputFn: v,
                otpModeConfig: c,
            });
            logger.info('[' + n + '] Subscribing to ChatGPT Plus...');
            o = await w.runAutopay();
            if (o.success || o.hint) break;
            if (o.noRetry) break;
            if (o.error && r < p - 1) {
                logger.error('[' + n + '] ' + o.error.substring(0, 150));
            }
        }
        if (o.success) {
            const x = path.join(__dirname, '..', 'accounts_plus.txt');
            const y = buildOtpLink(l, b);
            fs.appendFileSync(x, 'Email: ' + l + ' | Password: ' + m + ' | Link Cek Otp: ' + y + '\n');
            logger.success('[' + n + '] ' + a.green + '\u2713' + a.reset + ' ' + l + ' \u2192 Plus');
            j++;
            const z = fs.readFileSync(e, 'utf-8');
            const A = z.split('\n').filter(B => {
                const D = B.split('|')[0].trim();
                return !D.startsWith(l + ':');
            });
            fs.writeFileSync(e, A.join('\n'));
        } else {
            logger.error('[' + n + '] ' + o.error);
            if (o.hint) {
                logger.error('[' + n + '] ' + o.hint);
            }
        }
    }
    console.log('\n' + a.cyan + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    console.log('' + a.bold + a.white + ' LOGIN+AUTOPAY DONE' + a.reset + ' ' + a.green + j + a.reset + '/' + a.yellow + f.length + a.reset + ' accounts \u2192 Plus');
    console.log(a.cyan + '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550' + a.reset);
    try { await sharedCycleTLS.exit(); } catch {}
    sharedCycleTLS = null;
}

async function runCheckStatusMode(a) {
    console.log('\n' + a.bold + a.green + '══════════════════════════════════════════' + a.reset);
    console.log('' + a.bold + a.white + '  CHECK STATUS: Verifikasi Akun ChatGPT Plus' + a.reset);
    console.log('' + a.bold + a.green + '══════════════════════════════════════════' + a.reset + '\n');

    const plusFile = path.join(__dirname, '..', 'accounts_plus.txt');

    const srcFile = plusFile;
    const srcLabel = 'accounts_plus.txt';

    if (!fs.existsSync(srcFile)) {
        logger.error(srcLabel + ' tidak ditemukan!');
        return;
    }

    const lines = fs.readFileSync(srcFile, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    const accounts = lines.map(l => {
        const parts = l.split(':');
        if (parts.length < 2) return null;
        return { email: parts[0].trim(), password: parts.slice(1).join(':').trim(), raw: l };
    }).filter(Boolean);

    if (accounts.length === 0) {
        logger.error('Tidak ada akun valid di ' + srcLabel);
        return;
    }
    logger.info('Loaded ' + accounts.length + ' akun dari ' + srcLabel);

    let useProxy = false;
    let proxyUrlCheck = null;
    if (proxyUser && proxyPass) {
        const pInput = await getUserInput('Gunakan proxy untuk check? (y/n, default n): ');
        if (pInput.trim().toLowerCase() === 'y') {
            proxyUrlCheck = buildProxyUrl('sg', proxyUser, proxyPass, proxyHost, proxyPort);
            useProxy = true;
            logger.success('Proxy: ' + proxyHost + ':' + proxyPort);
        }
    }

    console.log('\n' + a.cyan + '─────────────────────────────────────────' + a.reset);

    const initCycleTLSFn = require('cycletls');
    const cycleTLS = await initCycleTLSFn();

    const results = { plus: [], expired: [], suspended: [], error: [] };

    for (let i = 0; i < accounts.length; i++) {
        const { email, password: pwd, raw } = accounts[i];
        const tag = a.cyan + '[' + (i + 1) + '/' + accounts.length + ']' + a.reset + ' ' + a.yellow + email + a.reset;
        process.stdout.write(tag + ' → checking...');

        try {
            const checker = new ChatGPTAutopay({
                email,
                password: pwd,
                name: email.split('@')[0],
                deviceId: require('uuid').v4(),
                proxyUrl: proxyUrlCheck,
                loginProxyUrl: proxyUrlCheck,
                checkoutProxyUrl: proxyUrlCheck,
                threadId: i + 1,
                sharedCycleTLS: cycleTLS,
                skipLogin: false,
                gopayPhone: '00000000000',
                gopayPin: '000000',
                webmailProvider: 'akbarmail',
                emailServiceDomain: emailServiceDomain,
                emailServiceApiKey: emailServiceApiKey,
            });

            await checker.loginToChatGPT();

            // Cek info akun + plan via accounts/check
            const meRes = await checker._oaiGet('https://chatgpt.com/backend-api/me');
            const me = meRes.data;

            const accRes = await checker._oaiGet('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27');
            const acc = accRes.data;

            await checker.cleanup();

            // Analisis status — struktur: accounts.default.entitlement
            const defaultAcc = acc?.accounts?.default || {};
            const entitlement = defaultAcc.entitlement || {};
            const accountInfo = defaultAcc.account || {};

            const isSuspended = me?.is_banned === true || accountInfo.is_deactivated === true || meRes.status === 403;
            const isPaidActive = entitlement.has_active_subscription === true;
            const planName = entitlement.subscription_plan || accountInfo.plan_type || '';
            const isPlus = isPaidActive && (planName.includes('plus') || planName.includes('pro') || planName.includes('team'));
            // expires_at adalah ISO date string (bukan timestamp)
            const expiresAt = entitlement.expires_at || entitlement.renews_at || null;

            process.stdout.write('\r' + tag + ' → ');
            if (isSuspended) {
                console.log(a.red + '✗ SUSPENDED' + a.reset);
                results.suspended.push(raw);
            } else if (isPlus) {
                const expDate = expiresAt ? new Date(expiresAt).toLocaleDateString('id-ID') : '-';
                console.log(a.green + '✓ PLUS AKTIF' + a.reset + a.gray + ' (' + planName + ', exp: ' + expDate + ')' + a.reset);
                results.plus.push(raw);
            } else {
                console.log(a.yellow + '~ TIDAK AKTIF' + a.reset + a.gray + ' (' + (planName || 'free') + ')' + a.reset);
                results.expired.push(raw);
            }
        } catch (err) {
            process.stdout.write('\r' + tag + ' → ');
            const msg = err.message || '';
            if (msg.toLowerCase().includes('suspend') || msg.includes('403') || msg.includes('banned') || msg.toLowerCase().includes('deactivat')) {
                console.log(a.red + '✗ SUSPENDED/BANNED' + a.reset);
                results.suspended.push(raw);
            } else {
                console.log(a.red + '✗ ERROR' + a.reset + a.gray + ' (' + msg.substring(0, 60) + ')' + a.reset);
                results.error.push(raw);
            }
        }

        if (i < accounts.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    try { await cycleTLS.exit(); } catch {}

    // Ringkasan
    console.log('\n' + a.cyan + '══════════════════════════════════════════' + a.reset);
    console.log(a.bold + a.white + ' HASIL CHECK STATUS' + a.reset);
    console.log(a.cyan + '──────────────────────────────────────────' + a.reset);
    console.log('  ' + a.green + '✓ Plus Aktif   : ' + results.plus.length + a.reset);
    console.log('  ' + a.yellow + '~ Expired/Free  : ' + results.expired.length + a.reset);
    console.log('  ' + a.red + '✗ Suspended    : ' + results.suspended.length + a.reset);
    console.log('  ' + a.gray + '? Error Login   : ' + results.error.length + a.reset);
    console.log(a.cyan + '══════════════════════════════════════════' + a.reset);

    // Update accounts_plus.txt — hanya simpan yang masih Plus aktif
    // Akun error (gagal login) dipertahankan agar tidak kehilangan data
    const keepInPlus = new Set([...results.plus, ...results.error].map(r => r.trim()));
    const updatedPlus = lines.filter(l => keepInPlus.has(l.trim()));
    fs.writeFileSync(srcFile, updatedPlus.join('\n') + (updatedPlus.length > 0 ? '\n' : ''));
    const removed = accounts.length - updatedPlus.length;
    if (removed > 0) {
        logger.warn(removed + ' akun tidak aktif dihapus dari accounts_plus.txt');
    }
    logger.success('accounts_plus.txt diperbarui (' + updatedPlus.length + ' akun aktif tersisa)');
}

async function main() {
    const a = '\n \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\n\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\n\u2588\u2588\u2551     \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551  \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d   \u2588\u2588\u2551\n\u2588\u2588\u2551     \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u255d    \u2588\u2588\u2551\n\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551   \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551         \u2588\u2588\u2551\n \u255a\u2550\u2550\u2550\u2550\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d   \u255a\u2550\u255d    \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d          \u255a\u2550\u255d\n=============================================================\n          ChatGPT Account Creator & Autopay Tool\n                  github.com/zzamcode\n=============================================================\n';
    console.log(a);
    // Auto-detect MuMu paths
    const mumuEnvManager = (process.env.MUMU_MANAGER_PATH || '').trim();
    const mumuEnvAdb = (process.env.MUMU_ADB_PATH || '').trim();
    if (!mumuEnvManager || !mumuEnvAdb) {
        const detected = autoDetectMuMu();
        if (detected) {
            logger.success('MuMu detected: ' + detected.manager);
            updateEnvFile({
                MUMU_MANAGER_PATH: detected.manager,
                MUMU_ADB_PATH: detected.adb,
            });
            process.env.MUMU_MANAGER_PATH = detected.manager;
            process.env.MUMU_ADB_PATH = detected.adb;
        }
    }
    const b = {
        reset: '\x1b[0m',
        cyan: '\x1b[36m',
        yellow: '\x1b[33m',
        green: '\x1b[32m',
        gray: '\x1b[90m',
        white: '\x1b[37m',
        magenta: '\x1b[35m',
        bold: '\x1b[1m',
        red: '\x1b[31m',
    };

    // ── Main Menu ──────────────────────────────────────────────────────────
    console.log(b.cyan + '═══════════════════════════════════════' + b.reset);
    console.log(b.bold + b.white + '  MAIN MENU' + b.reset);
    console.log(b.cyan + '═══════════════════════════════════════' + b.reset);
    console.log('  ' + b.yellow + '1.' + b.reset + ' ChatGPT Autopay ' + b.gray + '(Signup + GoPay)' + b.reset);
    console.log('  ' + b.yellow + '2.' + b.reset + ' Login + Autopay  ' + b.gray + '(Existing ChatGPT accounts)' + b.reset);
    console.log('  ' + b.yellow + '3.' + b.reset + ' Check Status     ' + b.gray + '(Cek Plus aktif/suspended)' + b.reset);
    console.log('  ' + b.yellow + '4.' + b.reset + ' Auto Create      ' + b.gray + '(Signup only → accounts.txt)' + b.reset);
    console.log('  ' + b.yellow + '0.' + b.reset + ' Exit');
    console.log(b.cyan + '───────────────────────────────────────' + b.reset);
    const menuChoice = await getUserInput('Pilih menu (1/2/3/4/0): ');
    console.log(b.cyan + '───────────────────────────────────────' + b.reset);

    if (menuChoice === '1') {
        return runAutopayMode(b);
    } else if (menuChoice === '2') {
        return runLoginAutopayMode(b);
    } else if (menuChoice === '3') {
        return runCheckStatusMode(b);
    } else if (menuChoice === '4') {
        return runSignupOnlyMode(b);
    } else {
        logger.info('Exiting...');
        process.exit(0);
    }
}

main().catch(a => {
    logger.error('Fatal error:', a);
    process.exit(1);
}).finally(() => {});
