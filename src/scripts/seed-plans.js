'use strict';

/**
 * Idempotently seeds the admin-curated recharge catalog (the offers owners see
 * under Subscription -> Recharge). Designed to be run safely on any database:
 * existing plans are matched by name and updated in place — nothing is deleted.
 *
 * Usage: npm run seed:plans
 */

const { connectDB, disconnectDB } = require('../config/db');
const RechargePlan = require('../models/RechargePlan');

const CATALOG = [
  {
    name: 'Yearly Plan',
    description: 'Covers the next 12 months after the free first year.',
    months: 12,
    price: 2999,
    badge: 'Best value',
    sortOrder: 1,
  },
  {
    name: 'Half-Yearly Plan',
    description: 'Recharge every 6 months at ₹2,500.',
    months: 6,
    price: 2500,
    badge: '',
    sortOrder: 2,
  },
  {
    name: 'Quarterly Plan',
    description: 'Pay every 3 months.',
    months: 3,
    price: 1299,
    badge: '',
    sortOrder: 3,
  },
  {
    name: 'Monthly Plan',
    description: 'Flexible monthly recharge.',
    months: 1,
    price: 499,
    badge: '',
    sortOrder: 4,
  },
];

async function main() {
  await connectDB();

  let created = 0;
  let updated = 0;

  for (const item of CATALOG) {
    const existing = await RechargePlan.findOne({ name: item.name });
    if (existing) {
      await RechargePlan.updateOne({ _id: existing._id }, { $set: { ...item, isActive: true } });
      updated += 1;
      console.log(`[seed:plans] Updated "${item.name}" (${item.months}mo · ₹${item.price})`);
    } else {
      await RechargePlan.create({ ...item, isActive: true });
      created += 1;
      console.log(`[seed:plans] Created "${item.name}" (${item.months}mo · ₹${item.price})`);
    }
  }

  const yearly = await RechargePlan.findOne({ name: 'Yearly Plan' });
  console.log(`[seed:plans] Done. created=${created} updated=${updated}. Yearly plan id=${yearly ? yearly._id.toString() : 'N/A'}`);
  await disconnectDB();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:plans] Failed:', err.message);
  process.exit(1);
});