'use strict';

const mongoose = require('mongoose');

const subscriptionService = require('./subscriptionService');
const logger = require('../config/logger');

// How often the auto-disable sweep re-runs (default: once an hour).
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h

// Brief idle before the first run so the HTTP server and DB settle.
const FIRST_RUN_DELAY_MS = 1000;

let timer = null;
let firstRunTimer = null;
let running = false;

/**
 * Fires the expiry sweep exactly once, never overlapping a run that is already
 * in flight. Each stale TRIAL/ACTIVE/EXPIRING subscription is flipped to
 * EXPIRED and mirrored onto its Business record (the "auto-disable").
 *
 * The run is skipped when MongoDB is not connected — server.js tolerates a
 * temporarily-unreachable DB at boot, and there is nothing to sweep anyway
 * until it recovers (health reports "degraded" meanwhile). This also stops a
 * mis-set env interval from queueing writes against a disconnected driver.
 */
async function runSweepOnce() {
  if (running) {
    logger.debug('[subscription-sweep] skipped — previous sweep still running');
    return;
  }
  if (mongoose.connection.readyState !== mongoose.Connection.STATES.connected) {
    logger.debug('[subscription-sweep] skipped — MongoDB not connected');
    return;
  }

  running = true;
  try {
    const result = await subscriptionService.runExpirySweep();
    if (result.expired > 0) {
      logger.info(
        `[subscription-sweep] auto-disabled ${result.expired}/${result.checked} expired subscription(s)`
      );
    } else {
      logger.debug(`[subscription-sweep] checked ${result.checked} — none to disable`);
    }
  } catch (err) {
    logger.error(`[subscription-sweep] run failed: ${err.message}`);
  } finally {
    running = false;
  }
}

/**
 * Starts the periodic auto-disable sweep.
 *
 * - Fires an immediate run shortly after boot so subscriptions that lapsed
 *   while the process was down are flagged right away.
 * - Re-runs every `intervalMs` (1 hour default; clamped to >= 1s).
 * - The timer is unref'd so it never keeps the process alive by itself.
 *
 * Calling again while already started is a no-op (idempotent).
 */
function startSweep(intervalMs = DEFAULT_INTERVAL_MS) {
  if (timer) return;

  const interval = Math.max(1000, parseInt(intervalMs, 10) || DEFAULT_INTERVAL_MS);
  firstRunTimer = setTimeout(() => {
    firstRunTimer = null;
    runSweepOnce();
  }, FIRST_RUN_DELAY_MS);
  timer = setInterval(runSweepOnce, interval);
  if (timer.unref) timer.unref();

  logger.info(`[subscription-sweep] started (interval ${interval}ms, immediate first run)`);
}

/**
 * Stops the periodic sweep and clears any pending first-run timer. Safe to call
 * more than once. Used by graceful shutdown so the process can exit cleanly.
 */
function stopSweeper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (firstRunTimer) {
    clearTimeout(firstRunTimer);
    firstRunTimer = null;
  }
}

module.exports = { startSweep, stopSweeper };