'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const { env } = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimitMiddleware');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
const storageService = require('./services/storageService');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const businessRoutes = require('./routes/businessRoutes');
const reportRoutes = require('./routes/reportRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const billRoutes = require('./routes/billRoutes');
const stockRoutes = require('./routes/stockRoutes');
const customerRoutes = require('./routes/customerRoutes');
const paymentController = require('./controllers/paymentController');
const paymentRoutes = require('./routes/paymentRoutes');
const syncRoutes = require('./routes/syncRoutes');
const deviceRoutes = require('./routes/deviceRoutes');

/**
 * Builds and configures the Express application.
 * Kept separate from server.js so integration tests can boot the app
 * without opening a network port.
 */
function createApp() {
  const app = express();

  // Reverse proxy awareness (trust X-Forwarded-* from Nginx/Render/Railway).
  app.set('trust proxy', 1);

  // Secure HTTP headers.
  app.use(helmet());

  // Compression for JSON payloads.
  app.use(compression());

  // CORS - allow configured origins, plus the dev origins.
  const allowed = env.corsOrigins.length
    ? env.corsOrigins
    : [`${env.clientUrl}`, `${env.adminUrl}`, `${env.ownerAppUrl}`].filter(Boolean);

  /**
   * Development convenience: browsers running Expo/Metro web or Vite can use
   * any loopback port (8081, 19006, ...) and Expo web may be opened over the
   * PC's LAN IP. Production keeps the strict allow-list above.
   */
  const isLocalOrigin = (origin) => {
    try {
      const { protocol, hostname } = new URL(origin);
      const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
      const isRfc1918Lan = /^(10|192\.168)\./.test(hostname);
      return protocol === 'http:' && (isLoopback || isRfc1918Lan);
    } catch {
      return false;
    }
  };

  app.use(
    cors({
      origin(origin, cb) {
        // Allow browsers without an Origin (same-origin, curl, native apps).
        if (!origin || allowed.includes(origin)) return cb(null, true);
        if (env.isDevelopment && isLocalOrigin(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    })
  );

  // Request logging (skip HTTP logs in test).
  if (env.nodeEnv !== 'test') {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  // Body parsing. Webhooks are mounted FIRST so express.raw() receives the
  // pristine request bytes — the JSON parser would consume the stream and
  // make HMAC verification impossible.
  app.use('/api/payments', paymentRoutes);
  // Razorpay subscription webhook — same idempotent handler, mounted on the
  // documented /api/subscription/webhook path with raw-body parsing.
  app.use('/api/subscription/webhook', express.raw({ type: '*/*' }), paymentController.handleWebhook);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Rate limiting.
  app.use('/api', apiLimiter);

  // Static uploads (development image storage). Uses the absolute directory
  // the storage service writes to, so uploaded images resolve no matter which
  // working directory the server was started from.
  app.use('/uploads', express.static(storageService.UPLOAD_DIR));

  // Routes.
  app.get('/', (req, res) =>
    res.json({ success: true, message: 'BillMitra API', data: { docs: '/api' } })
  );
  // API index so hitting /api directly returns a meaningful response.
  app.get('/api', (req, res) =>
    res.json({
      success: true,
      message: 'BillMitra API is running',
      data: {
        health: '/api/health',
        version: '0.1.0',
      },
    })
  );
  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/subscription', subscriptionRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/bills', billRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/devices', deviceRoutes);

  // 404 + centralized error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };