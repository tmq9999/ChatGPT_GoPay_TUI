function timestamp() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

// COLOR_RULE.md — Chuẩn hóa màu toàn bộ
const CLR = {
  info:    '\x1b[96m',   // Cyan (Light Blue) — Normal logging
  success: '\x1b[92m',   // Light Green — Success, checked, eligible
  warn:    '\x1b[93m',   // Light Yellow — Warning, init, retry
  error:   '\x1b[91m',   // Red (Light) — Error, not eligible, fail
  debug:   '\x1b[90m',   // Gray — Debug only (DEBUG=1)
};
const R = '\x1b[0m';

const logger = {
  info:    (a, ...b) => console.log(CLR.info + '[' + timestamp() + '] ' + a + R, ...b),
  success: (a, ...b) => console.log(CLR.success + '[' + timestamp() + '] ' + a + R, ...b),
  warn:    (a, ...b) => console.log(CLR.warn + '[' + timestamp() + '] ' + a + R, ...b),
  error:   (a, ...b) => console.log(CLR.error + '[' + timestamp() + '] ' + a + R, ...b),
  debug:   (a, ...b) => process.env.DEBUG && console.log(CLR.debug + '[' + timestamp() + '] ' + a + R, ...b),

  /**
   * Scoped logger — Format: [HH:MM:SS] - [#TX] - [email] - message
   */
  withContext: (threadId, email) => {
    const prefix = (level) => {
      const color = CLR[level] || CLR.info;
      return color + '[' + timestamp() + '] - [#T' + threadId + '] - [' + email + '] - ';
    };
    return {
      info:    (a, ...b) => console.log(prefix('info') + a + R, ...b),
      success: (a, ...b) => console.log(prefix('success') + a + R, ...b),
      warn:    (a, ...b) => console.log(prefix('warn') + a + R, ...b),
      error:   (a, ...b) => console.log(prefix('error') + a + R, ...b),
      debug:   (a, ...b) => process.env.DEBUG && console.log(prefix('debug') + a + R, ...b),
      coloredLine: (color, a, ...b) => console.log(color + '[' + timestamp() + '] - [#T' + threadId + '] - [' + email + '] - ' + a + R, ...b),
    };
  },
};

module.exports = logger;
