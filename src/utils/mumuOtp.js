const { execFile } = require('child_process');

function runExec(a, b, c = 15000) {
    return new Promise((d, e) => {
        execFile(a, b, { windowsHide: true, timeout: c, maxBuffer: 4194304 }, (f, g, h) => {
            if (f) {
                const i = new Error(h || g || f.message || 'command failed');
                i.code = f.code;
                i.stdout = g;
                i.stderr = h;
                i.args = b;
                e(i);
                return;
            }
            d({ stdout: String(g || ''), stderr: String(h || '') });
        });
    });
}

function normalizeDigits(a) {
    return String(a || '').replace(/\D/g, '');
}

function parseJsonLoose(a) {
    const b = String(a || '').trim();
    if (!b) return null;
    try { return JSON.parse(b); } catch (g) {}
    const c = b.indexOf('{');
    const d = b.lastIndexOf('}');
    if (c >= 0 && d > c) {
        const h = b.slice(c, d + 1);
        try { return JSON.parse(h); } catch (i) {}
    }
    const e = b.indexOf('[');
    const f = b.lastIndexOf(']');
    if (e >= 0 && f > e) {
        const j = b.slice(e, f + 1);
        try { return JSON.parse(j); } catch (k) {}
    }
    return null;
}

function parseInstancesFromOutput(a) {
    const b = String(a || '').trim();
    const c = [];
    const d = b.match(/get\s+player\s+list\s*:\s*\[(.*?)\]/i);
    if (d && d[1]) {
        const h = d[1].split(',').map(j => Number(j.trim())).filter(j => Number.isFinite(j) && j >= 0);
        const i = new Set();
        for (const j of h) {
            if (!i.has(j)) {
                i.add(j);
                c.push({ index: j, name: 'Instance ' + j });
            }
        }
        if (c.length > 0) return c.sort((k, l) => k.index - l.index);
    }
    const e = parseJsonLoose(b);
    if (Array.isArray(e)) {
        for (const k of e) {
            if (k && typeof k === 'object') {
                const l = k.index ?? k.idx ?? k.id ?? k.player_index ?? k.instance;
                const n = Number(l);
                const o = String(k.name ?? k.title ?? k.player_name ?? 'Instance ' + (Number.isFinite(n) ? n : 0));
                if (Number.isFinite(n) && n >= 0) c.push({ index: n, name: o });
            }
        }
    } else if (e && typeof e === 'object') {
        const p = [e.data, e.instances, e.list, e.players];
        for (const q of p) {
            if (!Array.isArray(q)) continue;
            for (const r of q) {
                if (!r || typeof r !== 'object') continue;
                const s = r.index ?? r.idx ?? r.id ?? r.player_index ?? r.instance;
                const t = Number(s);
                const u = String(r.name ?? r.title ?? r.player_name ?? 'Instance ' + (Number.isFinite(t) ? t : 0));
                if (Number.isFinite(t) && t >= 0) c.push({ index: t, name: u });
            }
        }
    }
    if (c.length > 0) return uniqByIndex(c);
    const f = [];
    const g = String(a || '').split(/\r?\n/);
    for (const v of g) {
        const w = v.trim();
        if (!w) continue;
        const x = w.match(/(?:index|idx|instance|player)\s*[:=]\s*(\d+).*?(?:name|title)?\s*[:=]?\s*([A-Za-z0-9 _.-]+)?/i);
        if (x) {
            const y = Number(x[1]);
            const z = x[2] ? x[2].trim() : 'Instance ' + y;
            if (Number.isFinite(y) && y >= 0) f.push({ index: y, name: z });
        }
    }
    return uniqByIndex(f);
}

function uniqByIndex(a) {
    const b = new Map();
    for (const c of a) {
        if (!b.has(c.index)) b.set(c.index, c);
    }
    return Array.from(b.values()).sort((d, e) => d.index - e.index);
}

async function listMuMuInstances(a) {
    const b = [
        ['info', '--vmindex', 'all'],
        ['info'],
        ['api', 'get_player_list'],
        ['api', 'list_player'],
        ['list'],
    ];
    for (const c of b) {
        try {
            const { stdout: d, stderr: e } = await runExec(a, c, 10000);
            const f = parseInstancesFromOutput(d + '\n' + e);
            if (f.length > 0) return f;
        } catch (g) {}
    }
    return [];
}

async function launchMuMuInstance(a, b) {
    const c = String(b);
    const d = [
        ['control', '--vmindex', c, 'launch'],
        ['control', '-v', c, 'launch'],
        ['control', '-v', c, '-c', 'launch_player'],
        ['api', '-v', c, 'launch_player'],
        ['api', 'launch_player', c],
        ['launch', '-v', c],
        ['launch', c],
        ['start', '-v', c],
        ['start', c],
    ];
    let e = null;
    for (const f of d) {
        try {
            await runExec(a, f, 20000);
            return;
        } catch (g) {
            e = g;
        }
    }
    throw e || new Error('Failed to launch MuMu instance');
}

function buildMuMuAdbSerialCandidates(a) {
    const b = Number(a);
    const c = [
        '127.0.0.1:' + (7555 + b),
        '127.0.0.1:' + (7555 + b * 2),
        '127.0.0.1:' + (16384 + b * 32),
        '127.0.0.1:5037',
    ];
    return Array.from(new Set(c));
}

async function adbDevices(a) {
    const { stdout: b } = await runExec(a, ['devices'], 10000);
    const c = String(b || '').split(/\r?\n/).slice(1);
    const d = [];
    for (const e of c) {
        const f = e.trim().match(/^(\S+)\s+(device|offline|unauthorized)$/i);
        if (f) d.push({ serial: f[1], state: f[2].toLowerCase() });
    }
    return d;
}

async function ensureAdbOnline(a, b) {
    const c = await adbDevices(a);
    const d = c.find(e => e.serial === b);
    if (d && d.state === 'device') return;
    if (d && d.state !== 'device') throw new Error('ADB device ' + b + ' state is ' + d.state);
    throw new Error('ADB device ' + b + ' not found');
}

async function connectMuMuAdb(a, b) {
    const c = Number(process.env.MUMU_SELECTED_INDEX || '0');
    const d = process.env.MUMU_MANAGER_PATH;
    // Try to get adb_port from MuMu info JSON
    let adbSerial = null;
    if (d) {
        try {
            const { stdout: infoOut } = await runExec(d, ['info', '--vmindex', String(c)], 10000);
            const infoJson = parseJsonLoose(infoOut);
            if (infoJson && infoJson.adb_port && infoJson.adb_host_ip) {
                adbSerial = infoJson.adb_host_ip + ':' + infoJson.adb_port;
            }
        } catch (h) {}
        try { await runExec(d, ['control', '--vmindex', String(c), 'launch'], 30000); } catch (h) {
            try { await runExec(d, ['api', '-v', String(c), 'launch_player'], 30000); } catch (i) {}
        }
    }
    const e = adbSerial
        ? [adbSerial, '127.0.0.1:7555', '127.0.0.1:7556', '127.0.0.1:7557', '127.0.0.1:7587', '127.0.0.1:5037']
        : ['127.0.0.1:7555', '127.0.0.1:7556', '127.0.0.1:7557', '127.0.0.1:7587', '127.0.0.1:5037'];
    let f = [];
    try { f = await adbDevices(a); } catch (i) {}
    for (const j of f) {
        if (e.includes(j.serial) && j.state === 'device') return j.serial;
    }
    let g = null;
    for (const k of e) {
        try {
            await runExec(a, ['connect', k], 12000);
            await new Promise(l => setTimeout(l, 1500));
            try {
                await ensureAdbOnline(a, k);
                return k;
            } catch (l) {}
        } catch (m) {
            g = m;
        }
    }
    throw g || new Error('Failed to connect ADB device for instance ' + c + '. Tried ports: ' + e.join(', '));
}

function adbShell(adbPath, device, cmd, timeout = 10000) {
    return runExec(adbPath, ['-s', device, 'shell', ...cmd], timeout);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Dump UI và return XML string
 */
async function getXml(adbPath, device) {
    await adbShell(adbPath, device, ['uiautomator', 'dump', '/sdcard/window.xml'], 10000);
    const { stdout } = await adbShell(adbPath, device, ['cat', '/sdcard/window.xml'], 10000);
    return stdout;
}

/**
 * Tìm element theo resource-id hoặc content-desc trong XML
 * Returns bounds center {cx, cy} hoặc null
 */
function findElement(xml, attr, value) {
    const nodes = xml.split('<');
    for (const node of nodes) {
        if (!node.includes(attr + '="' + value + '"')) continue;
        const bMatch = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        if (!bMatch) continue;
        return {
            cx: Math.round((parseInt(bMatch[1]) + parseInt(bMatch[3])) / 2),
            cy: Math.round((parseInt(bMatch[2]) + parseInt(bMatch[4])) / 2),
        };
    }
    return null;
}

/**
 * Mở WhatsApp → đọc tin nhắn GoPay mới nhất → lấy OTP → force-stop
 *
 * Flow:
 * 1. Force-stop WhatsApp (clean)
 * 2. Mở WhatsApp
 * 3. Chờ load → tìm & tap GoPay chat
 * 4. Đọc tin nhắn cuối cùng → extract 6-digit OTP
 * 5. Force-stop WhatsApp
 */
async function waitForWhatsAppOtpFromMuMu(a) {
    const {
        adbPath,
        deviceSerial,
        timeoutMs = 120000,
        pollMs = 3000,
        initialDelayMs = 5000,
        onUpdate,
    } = a || {};
    if (!adbPath) throw new Error('adbPath is required');
    if (!deviceSerial) throw new Error('deviceSerial is required');

    // Wait for OTP to arrive
    if (initialDelayMs > 0) {
        await sleep(initialDelayMs);
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const otp = await readLatestOtpFromWhatsApp(adbPath, deviceSerial);
            if (otp) return otp;
        } catch (err) {
            // Retry on failure
        }

        const remaining = timeoutMs - (Date.now() - startTime);
        if (typeof onUpdate === 'function') onUpdate(Math.max(0, remaining));
        await sleep(pollMs);
    }
    throw new Error('Timeout waiting OTP from WhatsApp');
}

/**
 * Core: mở WhatsApp → đọc OTP → đóng WhatsApp
 */
async function readLatestOtpFromWhatsApp(adbPath, deviceSerial) {
    try {
        // 1. Force-stop WhatsApp (clean state)
        await adbShell(adbPath, deviceSerial, ['am', 'force-stop', 'com.whatsapp']);
        await sleep(500);

        // 2. Mở WhatsApp
        await adbShell(adbPath, deviceSerial, ['am', 'start', '-n', 'com.whatsapp/.Main']);
        await sleep(4000);

        // 3. Tìm GoPay chat trong list
        let xml = await getXml(adbPath, deviceSerial);
        const gopayChat = findElement(xml, 'content-desc', 'Ảnh của GoPay');
        if (!gopayChat) {
            await adbShell(adbPath, deviceSerial, ['am', 'force-stop', 'com.whatsapp']);
            return null;
        }

        // Tap vào GoPay chat row (tap ở giữa màn hình cùng dòng, tránh avatar)
        await adbShell(adbPath, deviceSerial, ['input', 'tap', '450', String(gopayChat.cy)]);
        await sleep(2000);

        // 4. Đọc tin nhắn trong chat — tìm tin nhắn OTP cuối cùng (y lớn nhất)
        xml = await getXml(adbPath, deviceSerial);
        const messages = [];
        const nodes = xml.split('<');
        for (const node of nodes) {
            if (!node.includes('com.whatsapp:id/top_message')) continue;
            const textMatch = node.match(/text="([^"]*)"/);
            const boundsMatch = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
            if (textMatch && boundsMatch) {
                const text = textMatch[1];
                const y = parseInt(boundsMatch[2]);
                const otpMatch = text.match(/(\d{6})/);
                if (otpMatch) {
                    messages.push({ otp: otpMatch[1], y, text });
                }
            }
        }

        // 5. Force-stop WhatsApp → preload GoPay app cho bước unlink sau
        await adbShell(adbPath, deviceSerial, ['am', 'force-stop', 'com.whatsapp']);
        await adbShell(adbPath, deviceSerial, ['am', 'start', '-n', 'com.gojek.gopay/.MainActivity']).catch(() => {});

        if (messages.length === 0) return null;

        // Tin nhắn mới nhất = y lớn nhất (ở dưới cùng màn hình)
        messages.sort((a, b) => b.y - a.y);
        return messages[0].otp;
    } catch (err) {
        try { await adbShell(adbPath, deviceSerial, ['am', 'force-stop', 'com.whatsapp']); } catch {}
        return null;
    }
}

module.exports = {
    listMuMuInstances,
    launchMuMuInstance,
    connectMuMuAdb,
    waitForWhatsAppOtpFromMuMu,
};
