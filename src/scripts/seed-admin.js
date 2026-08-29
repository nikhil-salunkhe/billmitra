'use strict';

/**
 * Creates the first SUPER_ADMIN account from environment variables.
 * Refuses to run in production unless ALLOW_ADMIN_SEED=true.
 * Usage: npm run seed:admin
 */

const bcrypt = require('bcryptjs');

const { connectDB, disconnectDB } = require('../config/db');
const { env } = require('../config/env');
const { ROLES } = require('../config/constants');
const Admin = require('../models/Admin');

const BCRYPT_ROUNDS = 12;

async function seed() {
  if (env.isProduction && process.env.ALLOW_ADMIN_SEED !== 'true') {
    console.error(
      '[seed] Refusing to seed an admin in production. Set ALLOW_ADMIN_SEED=true only if intentional.'
    );
    process.exit(1);
  }

  const email = env.adminSeedEmail.trim().toLowerCase();
  const password = env.adminSeedPassword;
  const name = env.adminSeedName;

  if (!email || !password || password.length < 8) {
    console.error(
      '[seed] Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD (>= 8 characters) in .env to seed an admin.'
    );
    process.exit(1);
  }

  await connectDB();

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log(`[seed] SUPER_ADMIN already exists: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await Admin.create({ name, email, passwordHash, role: ROLES.SUPER_ADMIN, isActive: true });
    console.log(`[seed] Created SUPER_ADMIN: ${email}`);
  }

  await disconnectDB();
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});