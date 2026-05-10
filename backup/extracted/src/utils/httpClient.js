const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { HttpsProxyAgent } = require('https-proxy-agent');

const USER_AGENTS = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    ch: "\"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\", \"Google Chrome\";v=\"137\"",
    platform: "\"Windows\""
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    ch: "\"Chromium\";v=\"136\", \"Not.A/Brand\";v=\"99\", \"Google Chrome\";v=\"136\"",
    platform: "\"Windows\""
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    ch: "\"Chromium\";v=\"137\", \"Not/A)Brand\";v=\"24\", \"Google Chrome\";v=\"137\"",
    platform: "\"macOS\""
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
    ch: "\"Not/A)Brand\";v=\"24\", \"Microsoft Edge\";v=\"137\", \"Chromium\";v=\"137\"",
    platform: "\"Windows\""
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
    ch: "\"Not.A/Brand\";v=\"99\", \"Microsoft Edge\";v=\"136\", \"Chromium\";v=\"136\"",
    platform: "\"Windows\""
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
    ch: "\"Not.A/Brand\";v=\"99\", \"Microsoft Edge\";v=\"136\", \"Chromium\";v=\"136\"",
    platform: "\"macOS\""
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0",
    ch: null,
    platform: null
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:138.0) Gecko/20100101 Firefox/138.0",
    ch: null,
    platform: null
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    ch: "\"Chromium\";v=\"135\", \"Not-A.Brand\";v=\"8\", \"Google Chrome\";v=\"135\"",
    platform: "\"Windows\""
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
    ch: null,
    platform: null
  }
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const USER_AGENT = USER_AGENTS[0].ua;

function createClient(proxyUrl, timeout = 30000) {
  const jar = new CookieJar();
  const uaEntry = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const headers = {
    'User-Agent': uaEntry.ua,
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  };

  if (uaEntry.ch) {
    headers['sec-ch-ua'] = uaEntry.ch;
    headers['sec-ch-ua-mobile'] = '?0';
    headers['sec-ch-ua-platform'] = uaEntry.platform;
  }

  const config = {
    maxRedirects: 0,
    validateStatus: status => status < 500,
    headers,
    timeout
  };

  if (proxyUrl) {
    const agent = new HttpsProxyAgent(proxyUrl);
    config.httpsAgent = agent;
    config.httpAgent = agent;
    config.proxy = false;
  }

  const client = axios.create(config);

  client.interceptors.request.use(async req => {
    try {
      const cookieStr = await jar.getCookieString(req.url || req.baseURL || '');
      if (cookieStr) {
        req.headers = req.headers || {};
        req.headers.Cookie = cookieStr;
      }
    } catch {}
    return req;
  });

  client.interceptors.response.use(async res => {
    try {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const url = res.config.url || res.config.baseURL || '';
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const cookie of cookies) {
          await jar.setCookie(cookie, url);
        }
      }
    } catch {}
    return res;
  });

  client.followRedirects = async function (url, options = {}, maxFollows = 10) {
    let currentUrl = url;
    let response;
    for (let i = 0; i < maxFollows; i++) {
      response = await client.get(currentUrl, {
        ...options,
        maxRedirects: 0
      });
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        currentUrl = new URL(response.headers.location, currentUrl).href;
      } else {
        break;
      }
    }
    return response;
  };

  return { client, jar };
}

function buildProxyUrl(country, user, pass, host, port) {
  return 'http://' + user + ':' + pass + '@' + host + ':' + port;
}

module.exports = { createClient, buildProxyUrl, USER_AGENT };
