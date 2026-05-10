function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

const logger = {
  info: (a, ...b) => console.log('\x1b[90m[' + timestamp() + ']\x1b[36m [INFO]\x1b[0m ' + a, ...b),
  success: (a, ...b) => console.log('\x1b[90m[' + timestamp() + ']\x1b[32m [OK]\x1b[0m ' + a, ...b),
  warn: (a, ...b) => console.log('\x1b[90m[' + timestamp() + ']\x1b[33m [WARN]\x1b[0m ' + a, ...b),
  error: (a, ...b) => console.log('\x1b[90m[' + timestamp() + ']\x1b[31m [ERR]\x1b[0m ' + a, ...b),
  step: (a, b, ...c) => console.log('\x1b[90m[' + timestamp() + ']\x1b[35m [STEP ' + a + ']\x1b[0m ' + b, ...c),
  debug: (a, ...b) => process.env.DEBUG && console.log('\x1b[90m[' + timestamp() + '] [DBG] ' + a + '\x1b[0m', ...b)
};

module.exports = logger;
