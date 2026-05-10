/**
 * Proxy Pool
 * 
 * Loads proxies from a text file.
 * Supported formats per line:
 *   host:port:user:pass
 *   host:port
 *   user:pass@host:port
 *   http://user:pass@host:port
 * 
 * Empty file or missing file = no proxy.
 */

const fs = require('fs');
const logger = require('./logger');

function parseLine(line) {
  line = line.trim();
  if (!line || line.startsWith('#')) return null;

  // Format: http://user:pass@host:port
  if (line.startsWith('http://') || line.startsWith('https://')) {
    return line;
  }

  // Format: user:pass@host:port
  if (line.includes('@')) {
    return 'http://' + line;
  }

  const parts = line.split(':');

  // Format: host:port:user:pass
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return 'http://' + user + ':' + pass + '@' + host + ':' + port;
  }

  // Format: host:port (no auth)
  if (parts.length === 2) {
    return 'http://' + parts[0] + ':' + parts[1];
  }

  logger.warn('Invalid proxy format: ' + line);
  return null;
}

function loadProxies(filePath) {
  if (!filePath) return [];

  try {
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const proxies = content
      .split('\n')
      .map(parseLine)
      .filter(Boolean);

    return proxies;
  } catch (e) {
    return [];
  }
}

function assignProxy(proxies, index) {
  if (!proxies || proxies.length === 0) return null;
  return proxies[index % proxies.length];
}

/**
 * Check if a single proxy is alive by fetching a test URL through it
 * @param {string} proxyUrl - Formatted proxy URL (http://... or socks5://...)
 * @param {number} [timeout=10000] - Timeout in ms
 * @returns {Promise<{alive: boolean, ip?: string, ms: number, error?: string}>}
 */
async function checkProxyAlive(proxyUrl, timeout = 10000) {
  const start = Date.now();
  try {
    const https = require('https');
    const http = require('http');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const { SocksProxyAgent } = require('socks-proxy-agent');

    let url = proxyUrl;
    if (!url.includes('://')) url = 'http://' + url;
    const agent = url.startsWith('socks')
      ? new SocksProxyAgent(url)
      : new HttpsProxyAgent(url);

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'httpbin.org',
        port: 443,
        path: '/ip',
        method: 'GET',
        agent,
        timeout,
        headers: { 'User-Agent': 'ProxyCheck/1.0' },
      }, (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ alive: true, ip: json.origin || '', ms: Date.now() - start });
          } catch {
            resolve({ alive: true, ip: '?', ms: Date.now() - start });
          }
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.end();
    });

    return result;
  } catch (e) {
    return { alive: false, ms: Date.now() - start, error: e.message };
  }
}

/**
 * Check all proxies in parallel, print results table, return only live ones
 * @param {string[]} proxies - Array of proxy URLs
 * @returns {Promise<string[]>} - Array of live proxy URLs
 */
async function checkAllProxies(proxies) {
  if (!proxies || proxies.length === 0) return [];

  // COLOR_RULE.md colors
  const C = {
    cyan: '\x1b[96m', green: '\x1b[92m', red: '\x1b[91m',
    yellow: '\x1b[93m', gray: '\x1b[90m', bold: '\x1b[1m',
    white: '\x1b[37m', reset: '\x1b[0m',
  };

  const results = await Promise.allSettled(
    proxies.map(p => checkProxyAlive(p))
  );

  // Print table (W=68 inner, matching menu)
  console.log(C.bold + C.cyan + '  🌐 Proxy Health Check' + C.reset);
  console.log(C.cyan + '  ╔════╤════════════════════════════════╤════════╤═════════╤═══════════════════╗' + C.reset);
  console.log(C.cyan + '  ║  # │ Proxy                          │ Status │ Ping    │ IP                ║' + C.reset);
  console.log(C.cyan + '  ╠════╪════════════════════════════════╪════════╪═════════╪═══════════════════╣' + C.reset);

  const liveProxies = [];

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    const r = results[i].status === 'fulfilled' ? results[i].value : { alive: false, ms: 0, error: 'Check failed' };
    const num = String(i + 1).padStart(2);
    const display = proxy.replace(/:[^:@]+@/, ':***@').padEnd(30).substring(0, 30);
    const status = r.alive ? (C.green + '  ✅  ') : (C.red + '  ❌  ');
    const ping = (r.ms + 'ms').padEnd(7);
    const ip = (r.alive ? (r.ip || '?') : (r.error || 'Dead')).padEnd(17).substring(0, 17);

    console.log(
      C.cyan + '  ║' + C.reset + ' ' + C.white + num + C.reset +
      C.cyan + ' │' + C.reset + ' ' + display +
      C.cyan + ' │' + C.reset + status + C.reset +
      C.cyan + ' │' + C.reset + ' ' + (r.alive ? C.green : C.red) + ping + C.reset +
      C.cyan + ' │' + C.reset + ' ' + (r.alive ? C.green : C.gray) + ip + C.reset +
      C.cyan + ' ║' + C.reset
    );

    if (r.alive) liveProxies.push(proxy);
  }

  console.log(C.cyan + '  ╚════╧════════════════════════════════╧════════╧═════════╧═══════════════════╝' + C.reset);

  return liveProxies;
}

module.exports = { loadProxies, assignProxy, checkAllProxies };
