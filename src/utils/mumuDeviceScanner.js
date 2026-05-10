/**
 * MuMu Device Scanner — Auto-detect GoPay devices
 *
 * Convention: MuMu instance name = "PHONE_PIN"
 * Example: "6285735849445_050399"
 *   → phone = 6285735849445
 *   → pin   = 050399
 */

const { execFile } = require('child_process');
const logger = require('./logger');

function runExec(cmd, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 4194304 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(stderr || stdout || err.message || 'command failed');
        e.stdout = stdout;
        e.stderr = stderr;
        reject(e);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function parseJsonLoose(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  return null;
}

/**
 * Scan all running MuMu instances and extract GoPay config
 * @param {string} mumuManagerPath - Path to MuMuManager.exe
 * @returns {Array<{index: number, name: string, phone: string, pin: string, adbPort: number, adbSerial: string}>}
 */
async function scanGopayDevices(mumuManagerPath) {
  if (!mumuManagerPath) {
    logger.warn('MUMU_MANAGER_PATH not set');
    return [];
  }

  try {
    const { stdout } = await runExec(mumuManagerPath, ['info', '-v', 'all'], 10000);
    const data = parseJsonLoose(stdout);
    if (!data || typeof data !== 'object') {
      logger.warn('MuMu Manager returned invalid data');
      return [];
    }

    const devices = [];

    for (const [key, info] of Object.entries(data)) {
      // Only running instances
      if (!info.is_android_started || !info.is_process_started) continue;

      const index = Number(info.index ?? key);
      const name = String(info.name || '');
      const adbPort = info.adb_port || 0;
      const adbHost = info.adb_host_ip || '127.0.0.1';
      const adbSerial = adbPort ? (adbHost + ':' + adbPort) : '';

      // Parse name: "PHONE_PIN" or "PHONE"
      let phone = '';
      let pin = '';

      if (name.includes('_')) {
        const parts = name.split('_');
        phone = parts[0].replace(/\D/g, '');
        pin = parts.slice(1).join('_').trim();
      } else {
        // Name is just phone number — no PIN
        phone = name.replace(/\D/g, '');
      }

      if (!phone || phone.length < 8) {
        logger.warn('Instance ' + index + ' (' + name + '): phone invalid, skipping');
        continue;
      }

      if (!pin) {
        logger.warn('Instance ' + index + ' (' + name + '): no PIN found. Rename to PHONE_PIN (e.g. ' + phone + '_050399)');
        continue;
      }

      devices.push({
        index,
        name,
        phone,
        pin,
        adbPort,
        adbSerial,
      });
    }

    // Resolve actual ADB serial — use emulator-* from adb devices
    const adbPath = process.env.MUMU_ADB_PATH;
    if (adbPath && devices.length > 0) {
      try {
        const { stdout: adbOut } = await runExec(adbPath, ['devices'], 10000);
        const adbLines = String(adbOut).split(/\r?\n/).slice(1);
        const emulators = [];
        for (const line of adbLines) {
          const m = line.trim().match(/^(emulator-\d+)\s+device$/i);
          if (m) emulators.push(m[1]);
        }
        // Assign emulator serials to devices (round-robin)
        for (let i = 0; i < devices.length; i++) {
          if (emulators.length > 0) {
            devices[i].adbSerial = emulators[i % emulators.length];
          }
        }
      } catch {}
    }

    return devices.sort((a, b) => a.index - b.index);
  } catch (e) {
    logger.error('MuMu scan failed: ' + e.message);
    return [];
  }
}

/**
 * Connect ADB to a specific device
 */
async function connectDeviceAdb(mumuManagerPath, deviceIndex) {
  try {
    await runExec(mumuManagerPath, ['adb', '-v', String(deviceIndex), '-c', 'connect'], 10000);
    return true;
  } catch (e) {
    logger.warn('ADB connect failed for instance ' + deviceIndex + ': ' + e.message);
    return false;
  }
}

/**
 * Check which apps are installed on a device
 */
async function getInstalledApps(mumuManagerPath, deviceIndex) {
  try {
    const { stdout } = await runExec(
      mumuManagerPath,
      ['control', '-v', String(deviceIndex), 'app', 'info', '-i'],
      10000
    );
    return parseJsonLoose(stdout) || {};
  } catch {
    return {};
  }
}

/**
 * Print devices table to console
 */
function printDevicesTable(devices) {
  // COLOR_RULE.md colors
  const C = {
    cyan: '\x1b[96m', yellow: '\x1b[93m', green: '\x1b[92m',
    red: '\x1b[91m', bold: '\x1b[1m', reset: '\x1b[0m', white: '\x1b[37m',
  };

  if (devices.length === 0) {
    return;
  }

  console.log(C.bold + C.cyan + '  🎮 GoPay Devices (' + devices.length + ' found)' + C.reset);
  console.log(C.cyan + '  ╔════╤════════════╤══════════════════╤════════╤════════════════════════════╗' + C.reset);
  console.log(C.cyan + '  ║  # │ Instance   │ Phone            │ PIN    │ ADB                        ║' + C.reset);
  console.log(C.cyan + '  ╠════╪════════════╪══════════════════╪════════╪════════════════════════════╣' + C.reset);

  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    const num = String(i + 1).padStart(2);
    const idx = ('idx=' + d.index).padEnd(10);
    const phone = d.phone.padEnd(16);
    const pin = d.pin.padEnd(6);
    const adb = d.adbSerial.padEnd(26);
    console.log(
      C.cyan + '  ║' + C.reset + ' ' + C.white + num + C.reset +
      C.cyan + ' │' + C.reset + ' ' + C.yellow + idx + C.reset +
      C.cyan + ' │' + C.reset + ' ' + C.green + phone + C.reset +
      C.cyan + ' │' + C.reset + ' ' + C.bold + pin + C.reset +
      C.cyan + ' │' + C.reset + ' ' + adb +
      C.cyan + ' ║' + C.reset
    );
  }

  console.log(C.cyan + '  ╚════╧════════════╧══════════════════╧════════╧════════════════════════════╝' + C.reset);
}

module.exports = {
  scanGopayDevices,
  connectDeviceAdb,
  getInstalledApps,
  printDevicesTable,
};
