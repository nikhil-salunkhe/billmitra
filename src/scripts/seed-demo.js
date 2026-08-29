'use strict';

/**
 * Dev helper: seeds a demo business + owner from env (DEMO_BUSINESS_NAME, etc.)
 * for manual testing. Refuses to run in production.
 * Usage: npm run seed:demo
 */

const { connectDB, disconnectDB } = require('../config/db');
const { env } = require('../config/env');
const businessService = require('../services/businessService');

async function main() {
  if (env.isProduction) {
    console.error('[seed:demo] Refusing to run demo seed in production.');
    process.exit(1);
  }

  await connectDB();

  const name = process.env.DEMO_BUSINESS_NAME || 'Demo Garments';
  const username = (process.env.DEMO_OWNER_USERNAME || 'demo_owner').trim().toLowerCase();
  const password = process.env.DEMO_OWNER_PASSWORD || 'DemoOwner@123';

  const result = await businessService.createBusiness({
    businessName: name,
    businessType: 'GARMENT',
    ownerName: 'Demo Owner',
    ownerUsername: username,
    ownerPassword: password,
    city: 'Delhi',
    phone: '9000000000',
  });

  console.log(
    `[seed:demo] Business: ${result.business.businessName} (id=${result.business.id})`
  );
  console.log(`[seed:demo] Owner username: ${result.owner.username}`);
  console.log(`[seed:demo] One-time password: ${result.initialPassword}`);

  await disconnectDB();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:demo] Failed:', err.message);
  process.exit(1);
});