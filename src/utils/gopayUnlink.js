const { execFile } = require('child_process');
const logger = require('./logger');

function runExec(bin, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 4194304
    }, (err, stdout, stderr) => {
      if (err) {
        const error = new Error(stderr || stdout || err.message || 'command failed');
        error.code = err.code;
        reject(error);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function adbShell(adb, device, cmd, timeout = 10000) {
  return await runExec(adb, ['-s', device, 'shell', ...cmd], timeout);
}

/**
 * Force-stop GoPay app completely
 */
async function killGoPay(adb, device) {
  await adbShell(adb, device, ['am', 'force-stop', 'com.gojek.gopay']);
}

/**
 * Dump UI hierarchy and return raw XML string
 */
async function getXml(adb, device) {
  await adbShell(adb, device, ['uiautomator', 'dump', '/sdcard/window.xml'], 10000);
  return await adbShell(adb, device, ['cat', '/sdcard/window.xml'], 10000);
}

/**
 * Parse bounds string "[x1,y1][x2,y2]" → center {cx, cy}
 */
function parseBounds(boundsStr) {
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const x1 = parseInt(m[1]);
  const y1 = parseInt(m[2]);
  const x2 = parseInt(m[3]);
  const y2 = parseInt(m[4]);
  return {
    x1, y1, x2, y2,
    cx: Math.round((x1 + x2) / 2),
    cy: Math.round((y1 + y2) / 2),
  };
}

/**
 * Find element by content-desc keyword in XML.
 * Returns center coords {cx, cy} or null.
 *
 * @param {string} xml - Raw XML string from uiautomator dump
 * @param {string} desc - content-desc keyword to search (case-insensitive)
 * @param {object} [opts] - Options
 * @param {string} [opts.position] - 'bottom' to prefer element closer to bottom of screen
 * @param {boolean} [opts.clickable] - Only match clickable elements
 */
function findByDesc(xml, desc, opts = {}) {
  const nodes = xml.split('<');
  const matches = [];
  const descLower = desc.toLowerCase();

  for (const node of nodes) {
    if (!node.includes('content-desc=')) continue;

    const cdMatch = node.match(/content-desc="([^"]*)"/);
    if (!cdMatch) continue;

    const cd = cdMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&#10;/g, '\n')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    if (!cd.toLowerCase().includes(descLower)) continue;

    if (opts.clickable) {
      const clickMatch = node.match(/clickable="([^"]*)"/);
      if (!clickMatch || clickMatch[1] !== 'true') continue;
    }

    const bMatch = node.match(/bounds="(\[[^\]]+\]\[[^\]]+\])"/);
    if (!bMatch) continue;

    const bounds = parseBounds(bMatch[1]);
    if (!bounds) continue;

    matches.push(bounds);
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  if (opts.position === 'bottom') {
    return matches.reduce((a, b) => a.cy > b.cy ? a : b);
  }

  return matches.reduce((a, b) => a.cy < b.cy ? a : b);
}

/**
 * Dump UI → find element by content-desc → tap center
 * Returns true if tap succeeded, false if element not found
 */
async function tapByDesc(adb, device, desc, opts = {}) {
  const xml = await getXml(adb, device);
  const el = findByDesc(xml, desc, opts);
  if (!el) return false;
  await adbShell(adb, device, ['input', 'tap', String(el.cx), String(el.cy)]);
  return true;
}

/**
 * Wait for an element to appear, polling up to maxWait ms
 */
async function waitForElement(adb, device, desc, opts = {}, maxWait = 10000) {
  const pollMs = 2000;
  const attempts = Math.ceil(maxWait / pollMs);
  for (let i = 0; i < attempts; i++) {
    const xml = await getXml(adb, device);
    const el = findByDesc(xml, desc, opts);
    if (el) return el;
    if (i < attempts - 1) await sleep(pollMs);
  }
  return null;
}

/**
 * Gỡ liên kết OpenAI LLC khỏi GoPay
 * Flow chính xác từ floUnlinkedGoPay.md — KHÔNG thêm bước nào
 *
 * Steps:
 *   1. Force-stop GoPay (clean state)
 *   2. Open GoPay
 *   3. Tap Profile tab (bottom nav)
 *   4. Tap Account & app settings
 *   5. Tap Linked apps
 *   6. Tap Unlink button
 *   7. Tap Unlink confirm button
 *   8. Verify "No apps linked" → Force-stop GoPay
 */
async function unlinkOpenAIFromGoPay(adb, device, tag) {
  const t = tag || '';

  try {
    // Step 1: Open GoPay (use am start — if already open, just brings to front)
    await adbShell(adb, device, ['am', 'start', '-n', 'com.gojek.gopay/.MainActivity']);
    await sleep(2000);

    // Step 2: Wait for Profile tab to appear (app loaded)
    const profileEl = await waitForElement(adb, device, 'Profile', { clickable: true }, 15000);
    if (!profileEl) {
      logger.error(t + 'GoPay Unlink: Profile tab not found after waiting');
      await killGoPay(adb, device);
      return false;
    }
    // tap profile;
    await adbShell(adb, device, ['input', 'tap', String(profileEl.cx), String(profileEl.cy)]);
    await sleep(2000);

    // Step 4: Tap "Account & app settings"
    let ok = await tapByDesc(adb, device, 'app settings', { clickable: true });
    if (!ok) {
      logger.warn(t + 'GoPay Unlink: Account & app settings not found, retrying...');
      await sleep(2000);
      ok = await tapByDesc(adb, device, 'app settings', { clickable: true });
      if (!ok) {
        logger.error(t + 'GoPay Unlink: Account & app settings not found');
        await killGoPay(adb, device);
        return false;
      }
    }
    await sleep(2000);

    // Step 5: Tap Linked apps
    // tap linked apps;
    ok = await tapByDesc(adb, device, 'Linked apps', { clickable: true });
    if (!ok) {
      logger.warn(t + 'GoPay Unlink: Linked apps not found');
      await killGoPay(adb, device);
      return false;
    }
    await sleep(2000);

    // Poll for OpenAI to appear (may take time after payment settles)
    let xmlCheck = await getXml(adb, device);
    if (findByDesc(xmlCheck, 'No apps linked')) {
      logger.success(t + 'GoPay Unlink: Already unlinked ✓');
      await killGoPay(adb, device);
      return true;
    }

    if (!findByDesc(xmlCheck, 'OpenAI')) {
      logger.info(t + 'GoPay Unlink: Waiting for OpenAI to appear on Linked apps...');
      let found = false;
      for (let poll = 0; poll < 6; poll++) {
        await sleep(5000);
        // Re-tap Linked apps to refresh
        await tapByDesc(adb, device, 'Linked apps', { clickable: true });
        await sleep(2000);
        xmlCheck = await getXml(adb, device);
        if (findByDesc(xmlCheck, 'No apps linked')) {
          logger.success(t + 'GoPay Unlink: Already unlinked ✓');
          await killGoPay(adb, device);
          return true;
        }
        if (findByDesc(xmlCheck, 'OpenAI')) {
          found = true;
          break;
        }
        logger.info(t + 'GoPay Unlink: Poll ' + (poll + 1) + '/6...');
      }
      if (!found) {
        logger.warn(t + 'GoPay Unlink: OpenAI LLC not found after 30s polling');
        await killGoPay(adb, device);
        return false;
      }
    }


    // Step 6: Tap Unlink button (first/top one)
    // tap unlink;
    const el6 = findByDesc(xmlCheck, 'Unlink', { clickable: true });
    if (!el6) {
      logger.error(t + 'GoPay Unlink: Unlink button not found');
      await killGoPay(adb, device);
      return false;
    }
    await adbShell(adb, device, ['input', 'tap', String(el6.cx), String(el6.cy)]);
    await sleep(2000);

    // Verify confirmation dialog
    const xmlConfirm = await getXml(adb, device);
    if (!findByDesc(xmlConfirm, 'Unlink OpenAI LLC from GoPay')) {
      logger.warn(t + 'GoPay Unlink: Confirmation dialog not detected, retrying...');
      await sleep(1000);
      ok = await tapByDesc(adb, device, 'Unlink', { clickable: true });
      if (!ok) {
        logger.error(t + 'GoPay Unlink: Retry failed');
        await killGoPay(adb, device);
        return false;
      }
      await sleep(2000);
    }

    // Step 7: Tap Unlink confirm button (bottom one in dialog)
    // tap confirm;
    ok = await tapByDesc(adb, device, 'Unlink', { clickable: true, position: 'bottom' });
    if (!ok) {
      logger.error(t + 'GoPay Unlink: Confirm button not found');
      await killGoPay(adb, device);
      return false;
    }
    await sleep(3000);

    // Step 8: Verify "No apps linked to your GoPay"
    const xmlResult = await getXml(adb, device);
    const success = !!findByDesc(xmlResult, 'No apps linked');
    if (success) {
      logger.success(t + 'GoPay Unlink: Success ✓');
    } else {
      logger.warn(t + 'GoPay Unlink: Verification unclear');
    }

    // Force-stop GoPay (clean exit)
    await killGoPay(adb, device);

    return success;
  } catch (err) {
    logger.error(t + 'GoPay Unlink: Error: ' + err.message);
    try { await killGoPay(adb, device); } catch {}
    return false;
  }
}

module.exports = { unlinkOpenAIFromGoPay };
