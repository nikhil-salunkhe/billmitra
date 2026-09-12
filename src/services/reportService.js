'use strict';

const mongoose = require('mongoose');

const { ApiError } = require('../utils/ApiError');
const subscriptionService = require('./subscriptionService');
const Business = require('../models/Business');
const Bill = require('../models/Bill');
const { startOfDay, endOfDay, startOfMonth, endOfMonth, addMonthsClamped } = require('../utils/dateUtils');

/**
 * Authoritative quantities for a metric. Throws if the metric relies on a model
 * that is not yet available, so callers can degrade gracefully.
 */
function tryModel(name) {
  try {
    // eslint-disable-next-line global-require
    return require(`../models/${name}`);
  } catch {
    return null;
  }
}

/**
 * Owner dashboard aggregates, computed ONLY from data owned by the given
 * businessId (the tenant derived from the JWT).
 *
 * Fields whose backing collections land in later phases are returned as 0 with
 * an explicit flag so the UI never shows misleading values.
 */
async function getOwnerDashboard(businessId) {
  if (!businessId) throw ApiError.forbidden('No business tenant', 'NO_BUSINESS_TENANT');

  const business = await Business.findById(businessId).select('businessName businessType status subscriptionStatus');
  if (!business) throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');

  // Subscription summary (read-only preview).
  const subscription = await subscriptionService.getOwnerSubscription(businessId);

  // Bills & stock collections do not exist until Phases 8/9; compute them when
  // available, otherwise return explicit zeros + availability flags.
  let sales = {
    today: { bills: 0, revenue: 0, itemsSold: 0 },
    month: { bills: 0, revenue: 0 },
  };
  let lowStock = { count: 0 };
  const available = { bills: false, products: false };

  const Bill = tryModel('Bill');
  const Product = tryModel('Product');

  if (Bill) {
    available.bills = true;
    const [todayStart, todayEnd, monthStart, monthEnd] = [
      startOfDay(new Date()),
      endOfDay(new Date()),
      startOfMonth(new Date()),
      endOfMonth(new Date()),
    ];
    const oid = new mongoose.Types.ObjectId(businessId);
    const [todayAgg] = await Bill.aggregate([
      { $match: { businessId: oid, createdAt: { $gte: todayStart, $lte: todayEnd } } },
      { $facet: {
        totals: [{ $group: { _id: null, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } }],
        items: [{ $unwind: '$items' }, { $group: { _id: null, quantity: { $sum: '$items.quantity' } } }],
      } },
    ]);
    sales.today.bills = todayAgg?.totals?.[0]?.bills || 0;
    sales.today.revenue = todayAgg?.totals?.[0]?.revenue || 0;
    sales.today.itemsSold = todayAgg?.items?.[0]?.quantity || 0;

    const [monthAgg] = await Bill.aggregate([
      { $match: { businessId: oid, createdAt: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: null, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
    ]);
    sales.month.bills = monthAgg?.bills || 0;
    sales.month.revenue = monthAgg?.revenue || 0;
  }

  if (Product) {
    available.products = true;
    lowStock.count = await Product.countDocuments({ businessId, stockEnabled: true, $expr: { $lte: ['$currentStock', '$minimumStock'] } });
  }

  return {
    business: {
      businessId: business._id.toString(),
      businessName: business.businessName,
      businessType: business.businessType,
      status: business.status,
      subscriptionStatus: business.subscriptionStatus,
    },
    subscription,
    sales,
    lowStock,
    metricsAvailable: available, // honest: which underlying collections exist yet
  };
}

module.exports = { getOwnerDashboard };

// ---------------------------------------------------------------------------
// Reports (Phase 10) — tenant-scoped aggregations over Bill
// ---------------------------------------------------------------------------

const MAX_RANGE_DAYS = 400;

/** Converts minutes to a Mongo $dateToString timezone like "+05:30". */
function buildTzString(tzOffsetMinutes) {
  const sign = tzOffsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Resolves a UTC [start,end] window for the tenant's wall clock.
 * `tzOffsetMinutes` is the client's offset from UTC (e.g. 330 for IST).
 */
function resolveReportRange({ period = 'this_month', from = '', to = '', tzOffsetMinutes = 330 }) {
  const off = tzOffsetMinutes * 60000;
  // "Wall clock now": shift by offset, then read its UTC components as local ones.
  const shifted = new Date(Date.now() + off);
  const Y = shifted.getUTCFullYear();
  const M = shifted.getUTCMonth();
  const D = shifted.getUTCDate();

  // Build a UTC instant from tenant-wall-clock components.
  const wall = (y, m, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(Date.UTC(y, m, d, h, mi, s, ms) - off);

  let start;
  let end;

  switch (period) {
    case 'today':
      start = wall(Y, M, D);
      end = wall(Y, M, D, 23, 59, 59, 999);
      break;
    case 'yesterday': {
      const y = new Date(Date.UTC(Y, M, D - 1));
      start = wall(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate());
      end = wall(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate(), 23, 59, 59, 999);
      break;
    }
    case 'this_week': {
      // Monday-start week.
      const dow = shifted.getUTCDay(); // 0=Sun..6=Sat
      const backToMonday = (dow + 6) % 7;
      const mon = new Date(Date.UTC(Y, M, D - backToMonday));
      start = wall(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate());
      end = wall(Y, M, D, 23, 59, 59, 999);
      break;
    }
    case 'this_month':
      start = wall(Y, M, 1);
      end = new Date(Date.UTC(Y, M + 1, 1) - off - 1);
      break;
    case 'last_month': {
      const prev = addMonthsClamped(new Date(Date.UTC(Y, M, 1)), -1);
      start = wall(prev.getUTCFullYear(), prev.getUTCMonth(), 1);
      const pm = prev.getUTCMonth();
      const py = prev.getUTCFullYear();
      end = new Date(Date.UTC(py, pm + 1, 1) - off - 1);
      break;
    }
    case 'custom': {
      const parseDay = (str) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
        if (!m) return null;
        return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
      };
      const f = parseDay(from);
      const t = parseDay(to);
      if (!f || !t) {
        throw ApiError.validation('custom period requires from and to as YYYY-MM-DD', 'VALIDATION_ERROR', [
          { path: 'from', message: 'from/to must be YYYY-MM-DD' },
        ]);
      }
      if (from > to) {
        throw ApiError.validation('from must be on or before to', 'VALIDATION_ERROR', [
          { path: 'from', message: 'from must be <= to' },
        ]);
      }
      start = wall(f.y, f.mo, f.d);
      end = wall(t.y, t.mo, t.d, 23, 59, 59, 999);
      break;
    }
    default:
      throw ApiError.badRequest(`Unknown period: ${period}`, 'INVALID_PERIOD');
  }

  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (spanDays > MAX_RANGE_DAYS) {
    throw ApiError.validation(
      `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
      'VALIDATION_ERROR',
      [{ path: 'to', message: `Range too large (max ${MAX_RANGE_DAYS} days)` }]
    );
  }

  return { start, end, tz: buildTzString(tzOffsetMinutes) };
}

/**
 * Sales summary + payment breakdown + time series in a single round of
 * aggregations, all scoped to one tenant and range.
 */
async function getSalesReport(businessId, { start, end, tz }, groupBy = 'day') {
  const fmt = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const match = { businessId: new mongoose.Types.ObjectId(businessId), createdAt: { $gte: start, $lte: end } };

  const [res] = await Bill.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              bills: { $sum: 1 },
              grossSales: { $sum: '$subtotal' },
              discount: { $sum: '$discount' },
              totalTax: { $sum: '$totalTax' },
              netSales: { $sum: '$grandTotal' },
            },
          },
          { $project: { _id: 0, bills: 1, grossSales: 1, discount: 1, totalTax: 1, netSales: 1 } },
        ],
        itemsSold: [
          { $unwind: '$items' },
          { $group: { _id: null, quantity: { $sum: '$items.quantity' } } },
          { $project: { _id: 0, quantity: 1 } },
        ],
        byMethod: [
          {
            $group: {
              _id: '$paymentMethod',
              count: { $sum: 1 },
              amount: { $sum: '$grandTotal' },
            },
          },
          { $project: { _id: 0, method: '$_id', count: 1, amount: 1 } },
          { $sort: { amount: -1 } },
        ],
        series: [
          // CRITICAL FIX: Group by bill _id FIRST to get unique bills,
          // then group by date. This prevents bill totals from being
          // multiplied by the number of line items.
          {
            $group: {
              _id: '$_id',
              label: { $first: { $dateToString: { format: fmt, date: '$createdAt', timezone: tz } } },
              subtotal: { $first: '$subtotal' },
              discount: { $first: '$discount' },
              totalTax: { $first: '$totalTax' },
              grandTotal: { $first: '$grandTotal' },
            },
          },
          {
            $group: {
              _id: '$label',
              bills: { $sum: 1 },
              gross: { $sum: '$subtotal' },
              discount: { $sum: '$discount' },
              tax: { $sum: '$totalTax' },
              net: { $sum: '$grandTotal' },
            },
          },
          { $project: { _id: 0, label: '$_id', bills: 1, gross: 1, discount: 1, tax: 1, net: 1 } },
          { $sort: { label: 1 } },
        ],
      },
    },
  ]);

  const totals = res?.totals?.[0] || { bills: 0, grossSales: 0, discount: 0, totalTax: 0, netSales: 0 };
  const itemsSold = res?.itemsSold?.[0]?.quantity || 0;

  return {
    totals: { ...totals, itemsSold },
    byMethod: res?.byMethod || [],
    series: res?.series || [],
  };
}

/**
 * Top products by revenue (then quantity) within the range.
 */
async function getTopProducts(businessId, { start, end }, limit = 10) {
  const rows = await Bill.aggregate([
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(businessId),
        createdAt: { $gte: start, $lte: end },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.name' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineAmount' },
      },
    },
    { $project: { _id: 0, productId: '$_id', name: 1, quantity: 1, revenue: 1 } },
    { $sort: { revenue: -1, quantity: -1 } },
    { $limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 10)) },
  ]);

  return rows.map((r) => ({ ...r, productId: r.productId.toString() }));
}

module.exports.getReportRange = resolveReportRange;
module.exports.getSalesReport = getSalesReport;
module.exports.getTopProducts = getTopProducts;