'use strict';

/**
 * Self-contained health check: boots the app on an ephemeral port, probes /api/health,
 * prints the result and exits 0 on healthy / 1 otherwise.
 * Usage: npm run health
 */

const http = require('http');
const { env } = require('../config/env');
const { connectDB } = require('../config/db');
const { createApp } = require('../app');

async function main() {
  await connectDB().catch((err) => {
    console.error('DB connect failed:', err.message);
  });

  const app = createApp();
  const server = app.listen(0, () => {
    const port = server.address().port;
    http
      .get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          console.log(`HTTP ${res.statusCode}`);
          console.log(body);
          server.close();
          process.exit(res.statusCode === 200 ? 0 : 1);
        });
      })
      .on('error', (err) => {
        console.error('Probe error:', err.message);
        server.close();
        process.exit(1);
      });
  });
}

main().catch((err) => {
  console.error('Health check crashed:', err);
  process.exit(1);
});