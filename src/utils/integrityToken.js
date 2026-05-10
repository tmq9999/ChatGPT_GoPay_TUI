const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');

puppeteer.use(StealthPlugin());

async function extractIntegrityToken(token, proxyUrl, timeout = 35000) {
  let browser = null;
  try {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--window-size=1280,720'
    ];

    if (proxyUrl) {
      try {
        const parsed = new URL(proxyUrl);
        args.push('--proxy-server=' + parsed.hostname + ':' + parsed.port);
      } catch {}
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args
    });

    const page = await browser.newPage();

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36");

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      window.chrome = {
        runtime: {}
      };
    });

    if (proxyUrl) {
      try {
        const parsed = new URL(proxyUrl);
        if (parsed.username) {
          await page.authenticate({
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password)
          });
        }
      } catch {}
    }

    let capturedToken = null;
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');

    cdp.on('Network.requestWillBeSentExtraInfo', req => {
      const headers = req.headers || {};
      if (headers['x-oai-is'] && !capturedToken) {
        capturedToken = headers['x-oai-is'];
        logger.info("Integrity token captured via CDP (" + capturedToken.length + " chars)");
      }
    });

    cdp.on('Network.requestWillBeSent', req => {
      const headers = req.request?.headers || {};
      if (headers['x-oai-is'] && !capturedToken) {
        capturedToken = headers['x-oai-is'];
        logger.info("Integrity token captured (" + capturedToken.length + " chars)");
      }
    });

    logger.info("Integrity: Loading chatgpt.com...");
    try {
      await page.goto('https://chatgpt.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
    } catch (err) {
      logger.warn("Integrity: Navigation partial: " + err.message?.substring(0, 60));
    }

    const startTime = Date.now();
    while (!capturedToken && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const title = await page.title();
        if (title.includes("Just a moment")) {
          logger.info("Integrity: Cloudflare challenge detected, waiting...");
        }
      } catch {}
    }

    if (!capturedToken) {
      logger.info("Integrity: Triggering API call...");
      try {
        await page.evaluate(tok => {
          fetch('/backend-api/me', {
            headers: {
              'Authorization': "Bearer " + tok,
              'Content-Type': 'application/json'
            },
            credentials: 'include'
          }).catch(() => {});
        }, token);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch {}
    }

    if (capturedToken) {
      logger.success("Integrity token ✓ (" + capturedToken.substring(0, 40) + '...)');
    } else {
      try {
        const title = await page.title();
        const url = page.url();
        logger.warn("Integrity: NOT found — page title=\"" + title + "\" url=\"" + url + "\"");
      } catch {
        logger.warn("Integrity: NOT found — could not read page state");
      }
    }

    return capturedToken;
  } catch (err) {
    logger.warn("Integrity extraction failed: " + err.message?.substring(0, 100));
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

module.exports = { extractIntegrityToken };
