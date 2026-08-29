'use strict';

const mongoose = require('mongoose');
const { env } = require('./env');

/**
 * Establishes the MongoDB connection.
 * Returns the Mongoose connection used for health reporting.
 */
async function connectDB() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    console.info('[db] MongoDB connected');
  });
  mongoose.connection.on('error', (err) => {
    console.error('[db] MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB disconnected');
  });

  // Cloud clusters (Atlas) can occasionally fail server selection on flaky
  // networks; retry a few times before giving up so cold starts survive blips.
  const maxAttempts = env.nodeEnv === 'test' ? 1 : 3;
  const timeoutMs = env.nodeEnv === 'test' ? 3000 : 20000;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: timeoutMs });
      return mongoose.connection;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.warn(`[db] Connection attempt ${attempt}/${maxAttempts} failed (${err.message}); retrying...`);
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }
  throw lastErr;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

/**
 * Waits for every registered model's index build to finish.
 *
 * Critical for correctness: unique indexes (invoice numbers, idempotency keys,
 * SKUs) must exist BEFORE the first write, otherwise upserts/inserts racing an
 * in-progress index build can fail or bypass uniqueness.
 */
async function ensureIndexes() {
  const { models } = mongoose;
  await Promise.all(Object.keys(models).map((name) => models[name].init()));
}

module.exports = { connectDB, disconnectDB, ensureIndexes };