const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const logger = require('./logger');

function extractOtpFromSubject(a = '') {
    const b = [
        /your\s+(?:temporary\s+)?chatgpt\s+(?:verification\s+)?code\s+is\s*(\d{6})/i,
        /chatgpt\s+(?:verification\s+)?code\s+(?:is\s+)?(\d{6})/i,
        /verification\s+code[\s:]*(\d{6})/i,
        /temporary[\s:]+(\d{6})/i,
        /\b(\d{6})\b/,
    ];
    const input = String(a).substring(0, 200); // Limit to first 200 chars for logging
    for (let idx = 0; idx < b.length; idx++) {
        const c = b[idx];
        const d = input.match(c);
        if (d && d[1]) {
            logger.debug('[OTP] extractOtpFromSubject matched pattern #' + (idx + 1) + ': "' + d[0] + '" → OTP: ' + d[1]);
            return d[1];
        }
    }
    return null;
}

function extractOtpFromBody(a = '') {
    const b = [
        /temporary\s+verification\s+code\s+to\s+continue[\s\S]{0,2000}?(\d{6})/i,
        /enter\s+this\s+temporary[\s\S]{0,2000}?(\d{6})/i,
        /verification\s+code[\s\S]{0,2000}?(\d{6})/i,
        /your\s+chatgpt\s+code\s+is\s*(\d{6})/i,
        /login\s+code[\s\S]{0,2000}?(\d{6})/i,
        /<h1[^>]*>\s*(\d{6})\s*<\/h1>/i,
        /<h2[^>]*>\s*(\d{6})\s*<\/h2>/i,
        /<p[^>]*>\s*(\d{6})\s*<\/p>/i,
        /<td[^>]*>\s*(\d{6})\s*<\/td>/i,
        /<strong[^>]*>\s*(\d{6})\s*<\/strong>/i,
        /<span[^>]*>\s*(\d{6})\s*<\/span>/i,
        /<div[^>]*>\s*(\d{6})\s*<\/div>/i,
        />\s*(\d{6})\s*</,
    ];
    const c = new Set([
        '140729', '808080', '989898', '202123', '353740',
        '9800998', '000000', '111111', '222222', '333333',
        '444444', '555555', '666666', '777777', '888888',
        '999999', 'ffffff',
    ]);
    const input = String(a).substring(0, 500); // Limit for logging
    for (let idx = 0; idx < b.length; idx++) {
        const d = b[idx];
        const e = String(a).match(d);
        if (e && e[1] && !c.has(e[1].toLowerCase())) {
            return e[1];
        }
    }
    return null;
}

function isLikelyOpenAIMail(a = {}) {
    const b = String(getMessageString(a, ['from', 'sender', 'mail_from', 'email', 'from_email'])).toLowerCase();
    const c = String(getMessageString(a, ['subject', 'title', 'mail_subject'])).toLowerCase();
    return (
        b.includes('openai.com') ||
        b.includes('chatgpt') ||
        c.includes('chatgpt') ||
        c.includes('openai') ||
        c.includes('verification') ||
        c.includes('login code') ||
        c.includes('your chatgpt code')
    );
}

function getMessageString(a = {}, b = []) {
    for (const c of b) {
        const d = a?.[c];
        if (typeof d === 'string' && d.trim()) {
            return d.trim();
        }
        if (d && typeof d === 'object') {
            if (typeof d.address === 'string' && d.address.trim()) return d.address.trim();
            if (typeof d.email === 'string' && d.email.trim()) return d.email.trim();
            if (typeof d.value === 'string' && d.value.trim()) return d.value.trim();
            if (typeof d.text === 'string' && d.text.trim()) return d.text.trim();
        }
    }
    return '';
}

function isMessageForEmail(a = {}, b = '') {
    const c = String(b || '').toLowerCase();
    if (!c) return false;
    const d = [
        getMessageString(a, ['to', 'recipient', 'mail_to', 'email_to']),
        getMessageString(a, ['username', 'mailbox', 'inbox']),
        getMessageString(a, ['email']),
        getMessageString(a, ['address']),
    ].filter(Boolean).map(f => f.toLowerCase());
    if (d.some(f => f.includes(c))) return true;
    const e = c.split('@')[0];
    if (e && d.some(f => f.includes(e))) return true;
    return false;
}

function collectCodesFromMessage(a = {}) {
    const b = getMessageString(a, ['subject', 'title', 'mail_subject']);
    const c = getMessageString(a, ['body', 'text', 'html', 'content']);
    const d = [];
    const e = extractOtpFromSubject(b);
    if (e) d.push(e);
    const f = extractOtpFromBody(c);
    if (f && f !== e) d.push(f);
    if (d.length === 0) {
        const g = collectTextFragments(a);
        for (const h of g) {
            const i = extractOtpFromBody(h) || extractOtpFromSubject(h);
            if (i && !d.includes(i)) d.push(i);
        }
    }
    return d;
}

function collectTextFragments(a, b = [], c = new Set()) {
    if (a == null) return b;
    if (typeof a === 'string') {
        const d = a.trim();
        if (d) b.push(d);
        return b;
    }
    if (typeof a !== 'object') return b;
    if (c.has(a)) return b;
    c.add(a);
    if (Array.isArray(a)) {
        for (const e of a) collectTextFragments(e, b, c);
        return b;
    }
    for (const f of Object.values(a)) {
        collectTextFragments(f, b, c);
    }
    return b;
}

function buildPrioritizedMessages(a = [], b = '') {
    const c = a.filter(e => isMessageForEmail(e, b));
    const d = c.length > 0 ? c : a;
    return [...d.filter(isLikelyOpenAIMail), ...d.filter(e => !isLikelyOpenAIMail(e))];
}

async function fetchOtpTmailCandidates(a, b, c) {
    // Gunakan TempMail Zam untuk semua email
    // a bisa full email (user@domain) atau hanya username
    const mailboxId = a.includes('@') ? a.split('@')[0] : a;
    const emailDomain = a.includes('@') ? a.split('@')[1] : undefined;
    return fetchOtpTempmailCandidates(mailboxId, b, emailDomain);
    const d = b + '/api/messages/' + a + '/' + c;
    try {
        const e = await axios.get(d, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Accept: 'application/json',
            },
            timeout: 30000,
        });
        if (e.status !== 200 || !Array.isArray(e.data) || e.data.length === 0) {
            return [];
        }
        const f = buildPrioritizedMessages(e.data, a);
        const g = [];
        const h = new Set();
        for (const i of f) {
            const j = collectCodesFromMessage(i);
            for (const k of j) {
                const l = String(k);
                if (!h.has(l)) {
                    h.add(l);
                    g.push(l);
                }
            }
        }
        return g;
    } catch (m) {
        if (m.response) {
            logger.error('Tmail API error: ' + m.response.status);
        } else {
            logger.error('Tmail API error: ' + m.message);
        }
        return [];
    }
}

async function fetchOtpTmail(a, b, c, d = []) {
    const e = new Set(d.map(g => String(g)));
    const f = await fetchOtpTmailCandidates(a, b, c);
    for (const g of f) {
        if (!e.has(String(g))) {
            return g;
        }
        logger.debug('Ignoring old OTP code: ' + g);
    }
    logger.warn('OTP not found in email subject/body across inbox messages');
    return null;
}



async function fetchOtpWithRetry(a, b, c = 30, d = 5000, e = {}) {
    const {
        provider = 'tempmail',
        serviceDomain: f,
        apiKey: g,
    } = b;
    const {
        skipInitialDelay = false,
        excludeCodes = [],
        suppressFinalError = false,
        quickScan = false,
        initialDelay: i,
    } = e;
    
    logger.debug('fetchOtpWithRetry: email=' + a + ', provider=' + provider + ', apiKey set=' + (g ? 'yes' : 'no'));
    
    const j = new Set(excludeCodes.map(k => String(k)));
    if (!skipInitialDelay) {
        const k = i != null ? i : 30000;
        logger.info('Waiting ' + k / 1000 + 's for email to arrive...');
        await new Promise(l => setTimeout(l, k));
    }
    
    for (let l = 1; l <= c; l++) {
        let m = null;
        if (provider === 'tempmail') {
            const mailboxId = b.tempmailMailboxId || a.split('@')[0];
            const emailDomain = a.includes('@') ? a.split('@')[1] : '';
            const n = await fetchOtpTempmailCandidates(mailboxId, f, emailDomain);
            m = n.find(o => !j.has(String(o))) || null;
        } else {
            m = await fetchOtpTmail(a, f, g, [...j]);
        }
        if (m && !j.has(String(m))) {
            return m;
        }
        if (m && j.has(String(m))) {
            logger.debug('Ignoring old OTP code: ' + m);
        }
        if (l < c) {
            logger.warn('OTP not received, retrying in ' + d / 1000 + 's... (' + l + '/' + c + ')');
            await new Promise(o => setTimeout(o, d));
        }
    }
    if (!suppressFinalError) {
        logger.error('OTP fetch failed after all retries');
    }
    return null;
}

async function fetchOtpTempmailCandidates(mailboxId, b, domain) {
    const mailbox = mailboxId;
    const base = (b || 'https://tempmailzam.biz.id').replace(/\/$/, '');
    const domainParam = domain ? '&d=' + encodeURIComponent(domain) : '';
    try {
        const listRes = await axios.get(base + '/api/emails?m=' + mailbox + domainParam, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                Accept: 'application/json',
            },
            timeout: 15000,
        });
        if (listRes.status !== 200 || !listRes.data?.emails || !listRes.data.emails.length) {
            return [];
        }
        const emails = listRes.data.emails.slice(0, 5);
        const codes = [];
        const seen = new Set();
        for (const em of emails) {
            try {
                const detailRes = await axios.get(base + '/api/email-detail?m=' + mailbox + '&id=' + em.id + domainParam, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                        Accept: 'application/json',
                    },
                    timeout: 15000,
                });
                if (detailRes.status !== 200 || !detailRes.data?.data) continue;
                const d = detailRes.data.data;
                const subjectCode = extractOtpFromSubject(d.subject || '');
                const bodyCode = extractOtpFromBody((d.text || '') + ' ' + (d.html || ''));
                for (const c of [subjectCode, bodyCode]) {
                    if (c && !seen.has(c)) {
                        seen.add(c);
                        codes.push(c);
                    }
                }
            } catch (e) {}
        }
        return codes;
    } catch (e) {
        logger.error('TempMail Zam error: ' + e.message);
        return [];
    }
}

module.exports = {
    fetchOtpTmail,
    fetchOtpTmailCandidates,
    fetchOtpTempmailCandidates,
    fetchOtpAkbarMailCandidates: fetchOtpTempmailCandidates,  // Backward compatibility
    fetchOtpWithRetry,
};
