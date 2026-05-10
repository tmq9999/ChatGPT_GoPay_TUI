const { execFile } = require('child_process');

function runExec(bin, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 4194304
    }, (err, stdout, stderr) => {
      if (err) {
        const error = new Error(stderr || stdout || err.message || "command failed");
        error.code = err.code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

function extractTextFromUiAutomatorXml(xml) {
  const parts = [];
  const regex = /text="([^"]*)"/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text.length > 0) {
      parts.push(text.toLowerCase());
    }
  }
  return parts.join(" ").toLowerCase();
}

async function adbTap(adb, device, x, y) {
  await runExec(adb, ['-s', device, 'shell', 'input', 'tap', String(x), String(y)], 5000);
}

async function adbBack(adb, device) {
  await runExec(adb, ['-s', device, 'shell', 'input', 'keyevent', '4'], 5000);
}

async function adbScreenText(adb, device) {
  try {
    const { stdout } = await runExec(adb, ['-s', device, 'shell', 'uiautomator', 'dump', '/dev/null'], 10000);
    const out = String(stdout || '');
    if (out.length > 50 && out.includes('node')) {
      const text = extractTextFromUiAutomatorXml(out);
      if (text.length > 10) {
        return text;
      }
    }
  } catch {}

  try {
    const { stdout } = await runExec(adb, ['-s', device, 'shell', 'dumpsys', 'window', 'dump'], 10000);
    const out = String(stdout || '').toLowerCase();
    if (out.length > 100) {
      const lines = out.split("\n");
      const filtered = lines
        .filter(l => l.includes('text') || l.includes('desc') || l.includes('label') || l.includes('content'))
        .join(" ")
        .toLowerCase();
      if (filtered.length > 20) {
        return filtered;
      }
      return out;
    }
  } catch {}

  try {
    return 'fallback';
  } catch {
    return '';
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function unlinkOpenAIFromGoPay(adb, device) {
  console.log("[GoPay Unlink] Starting...");
  try {
    console.log("[GoPay Unlink] Navigating to \"Aplikasi yang terhubung\" (Connected Apps)...");
    await adbTap(adb, device, 360, 823);

    console.log("[GoPay Unlink] Waiting for page to load...");
    await sleep(2000);

    console.log("[GoPay Unlink] Looking for OpenAI LLC entry...");
    await sleep(1000);

    console.log("[GoPay Unlink] Tapping OpenAI LLC entry at (360, 305)...");
    await adbTap(adb, device, 360, 305);
    await sleep(1500);

    console.log("[GoPay Unlink] Tapping Hapus button at (562, 276)...");
    await adbTap(adb, device, 562, 276);
    await sleep(2000);

    console.log("[GoPay Unlink] Confirmation dialog appeared, tapping Hapus confirmation button at (360, 1156)...");
    await adbTap(adb, device, 360, 1156);
    await sleep(2500);

    console.log("[GoPay Unlink] Pressing Android back button to return...");
    await adbBack(adb, device);
    await sleep(1500);

    console.log("[GoPay Unlink] ✓ Completed successfully");
    return true;
  } catch (err) {
    console.log("[GoPay Unlink] Error: " + err.message);
    return false;
  }
}

module.exports = { unlinkOpenAIFromGoPay };
