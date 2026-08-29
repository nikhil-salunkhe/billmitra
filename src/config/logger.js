'use strict';

const { env } = require('./env');

/**
 * Lightweight structured logger.
 * In production only errors are written; in development verbose info is included.
 * Sensitive data (passwords, tokens, payment credentials) must never be passed here.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = env.isProduction ? LEVELS.info : LEVELS.debug;

function write(level, args) {
  if (LEVELS[level] > threshold) return;
  const ts = new Date().toISOString();
  const msg = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const logger = {
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};

module.exports = logger;