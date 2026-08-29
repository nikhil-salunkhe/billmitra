'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const { env } = require('../config/env');
const { ApiError } = require('../utils/ApiError');

/**
 * Image storage abstraction.
 *
 * - 'local'      : files written to backend/uploads and served by express.static
 *                  (development / simple deployments).
 * - 'cloudinary' : reserved for production; requires credentials in .env.
 *
 * Binary images are never stored inside MongoDB.
 */

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const diskStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
    const safeExt = /^\.(jpg|jpeg|png|webp)$/.test(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(ApiError.validation('Only JPEG, PNG or WebP images are allowed', 'INVALID_FILE_TYPE'));
  }
  return cb(null, true);
}

/** Builds a single-file multer uploader for the given multipart field name. */
function createImageUploader(fieldName) {
  return multer({
    storage: diskStorage,
    fileFilter,
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  }).single(fieldName);
}

/** Accepts a single multipart field named "image" (product/category images). */
const productImageUpload = createImageUploader('image');

/** Accepts a single multipart field named "logo" (business logo uploads). */
const businessLogoUpload = createImageUploader('logo');

function publicUrlFor(filename) {
  return `${env.nodeEnv === 'production' ? '' : ''}/uploads/${filename}`;
}

/**
 * Stores an already-validated uploaded file and returns its public URL.
 */
async function saveUploadedImage(file) {
  if (!file) throw ApiError.badRequest('No image provided', 'NO_FILE');
  if (env.storage.provider === 'local') {
    return publicUrlFor(file.filename);
  }
  // Other providers are wired when their credentials are configured.
  throw ApiError.internal(
    `Storage provider "${env.storage.provider}" is not configured yet`,
    'STORAGE_PROVIDER_UNAVAILABLE'
  );
}

/**
 * Stores an already-validated uploaded file and returns its public URL.
 */
async function saveProductImage(file) {
  return saveUploadedImage(file);
}

/**
 * Stores the business owner logo. Local provider only; remote providers are
 * wired when their credentials are configured.
 */
async function saveBusinessLogo(file) {
  return saveUploadedImage(file);
}

/**
 * Deletes a previously uploaded local file. Accepts either a server-relative
 * URL ("/uploads/name.png") or a bare filename. No-op on remote providers and
 * on missing files, so callers can safely clean up during rollbacks.
 */
async function removeUploadedFile(urlOrFilename) {
  if (env.storage.provider !== 'local') return;
  const name = String(urlOrFilename || '').split('/').pop();
  if (!name) return;
  const absolute = path.join(UPLOAD_DIR, name);
  try {
    await fs.promises.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // A stale file is not worth failing a request over — surface softly.
      console.warn(`[storage] Failed to remove image "${name}": ${err.message}`);
    }
  }
}

module.exports = {
  productImageUpload,
  businessLogoUpload,
  saveProductImage,
  saveBusinessLogo,
  removeUploadedFile,
  UPLOAD_DIR,
};