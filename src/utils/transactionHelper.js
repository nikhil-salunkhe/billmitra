'use strict';

const mongoose = require('mongoose');

/**
 * Runs `fn(session)` inside a MongoDB multi-document transaction when the
 * connected topology supports them (replica set / sharded cluster, e.g. Atlas),
 * and falls back to running without a session on standalone deployments where
 * transactions are unavailable (local dev/test mongod).
 *
 * The support check is cached per connection to avoid repeated admin commands.
 */

let topologySupportsTx = null;

async function checkTransactionsSupported() {
  if (topologySupportsTx !== null) return topologySupportsTx;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    // setName -> replica set member; msg isdbgrid -> sharded cluster (mongos).
    topologySupportsTx = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch (err) {
    console.warn('[tx] Topology probe failed; assuming no transaction support:', err.message);
    topologySupportsTx = false;
  }
  return topologySupportsTx;
}

/** Test helper: clears the cached probe (used when tests switch databases). */
function resetTopologyCache() {
  topologySupportsTx = null;
}

/**
 * Executes fn(session) atomically when possible.
 */
async function runInTransaction(fn) {
  const supported = await checkTransactionsSupported();
  if (!supported) {
    // Standalone: sequential execution, each individual write is atomic.
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { runInTransaction, checkTransactionsSupported, resetTopologyCache };