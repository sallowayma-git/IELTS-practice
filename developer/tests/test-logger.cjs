/**
 * Simple Test Logger (no Electron dependency)
 * For standalone Node.js testing
 */

const logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => console.log('[DEBUG]', ...args)
};

module.exports = logger;
