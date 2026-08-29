'use strict';

const mongoose = require('mongoose');
const express = require('express');
const { success } = require('../utils/ApiResponse');
const { env } = require('../config/env');

const router = express.Router();

/**
 * GET /api/health
 * Lightweight liveness check. Does not require DB, but reports DB connection state.
 */
router.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  const dbOk = mongoose.connection.readyState === 1;

  success(
    res,
    {
      status: dbOk ? 'ok' : 'degraded',
      service: 'billmitra-backend',
      version: '0.1.0',
      environment: env.nodeEnv,
      time: new Date().toISOString(),
      db: { state: dbState, ok: dbOk },
    },
    dbOk ? 'BillMitra API is running' : 'Service running, database not connected'
  );
});

module.exports = router;