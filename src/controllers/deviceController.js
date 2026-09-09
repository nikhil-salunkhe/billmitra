'use strict';

const syncService = require('../services/syncService');
const { success } = require('../utils/ApiResponse');

/**
 * POST /api/devices/register
 * Body: { deviceId, deviceName, platform, appVersion }
 * Idempotent upsert scoped by the authenticated tenant + user.
 */
async function register(req, res, next) {
  try {
    const { deviceId, deviceName, platform, appVersion } = req.body || {};
    const device = await syncService.registerDevice({
      businessId: req.businessId,
      userId: req.user.id,
      deviceId,
      deviceName,
      platform,
      appVersion,
    });
    return success(res, { deviceId: device.deviceId, registered: true }, 'Device registered');
  } catch (err) {
    return next(err);
  }
}

module.exports = { register };