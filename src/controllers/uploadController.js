'use strict';

const { success } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const storageService = require('../services/storageService');
const { ApiError } = require('../utils/ApiError');

/**
 * POST /api/uploads/product-image  (multipart, field: "image")
 * Stores the image and returns its public URL for Product.imageUrl.
 */
const uploadProductImage = [
  (req, res, next) => {
    storageService.productImageUpload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.validation('Image exceeds 5 MB', 'FILE_TOO_LARGE'));
      }
      return next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const url = await storageService.saveProductImage(req.file);
    return success(res, { imageUrl: url }, 'Image uploaded');
  }),
];

/**
 * POST /api/admin/businesses/upload-logo  (multipart, field: "logo")
 * Stores the owner business logo and returns its public URL to be saved on
 * the Business record (Business.logoUrl).
 */
const uploadBusinessLogo = [
  (req, res, next) => {
    storageService.businessLogoUpload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.validation('Logo exceeds 5 MB', 'FILE_TOO_LARGE'));
      }
      return next(err);
    });
  },
  asyncHandler(async (req, res) => {
    const url = await storageService.saveBusinessLogo(req.file);
    return success(res, { logoUrl: url }, 'Logo uploaded');
  }),
];

module.exports = { uploadProductImage, uploadBusinessLogo };