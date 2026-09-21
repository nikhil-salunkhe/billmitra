'use strict';

const { env } = require('./config/env');
const { connectDB, disconnectDB, ensureIndexes } = require('./config/db');
const logger = require('./config/logger');
const { createApp } = require('./app');

const app = createApp();

let server;

async function start() {
  try {
    await connectDB();
    // Unique indexes (invoice numbers, idempotency keys, SKUs) must be ready
    // before the API accepts its first write.
    await ensureIndexes();
  } catch (err) {
    // Do not crash on startup if the DB is temporarily unreachable;
    // the health endpoint will report "degraded" until it recovers.
    logger.warn(`Database initial connection failed: ${err.message}`);
  }

  server = app.listen(env.port, "0.0.0.0", () => {
    logger.info(`BillMitra API listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    if (server) server.close();
    try {
      await disconnectDB();
    } catch (err) {
      logger.error(`Disconnect error: ${err.message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();

module.exports = { app };