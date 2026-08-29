'use strict';

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { ApiError } = require('../utils/ApiError');

/** Lists categories for one tenant, newest first. */
async function listCategories(businessId, { includeInactive = false } = {}) {
  if (!businessId) throw ApiError.forbidden('No business tenant', 'NO_BUSINESS_TENANT');
  const filter = { businessId };
  if (!includeInactive) filter.isActive = true;
  const docs = await Category.find(filter).sort({ name: 1 }).lean();
  return docs.map((c) => ({ ...c, id: c._id.toString() }));
}

async function getCategory(businessId, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid category id', 'INVALID_ID');
  // Tenant filter is part of the query itself: a foreign id simply is not found.
  const cat = await Category.findOne({ _id: id, businessId });
  if (!cat) throw ApiError.notFound('Category not found', 'CATEGORY_NOT_FOUND');
  return cat;
}

/**
 * Creates a category. Duplicate names inside the tenant are rejected.
 */
async function createCategory(businessId, { name, description }) {
  if (!businessId) throw ApiError.forbidden('No business tenant', 'NO_BUSINESS_TENANT');
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw ApiError.badRequest('Category name is required', 'MISSING_FIELDS');

  const exists = await Category.exists({ businessId, name: new RegExp(`^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (exists) throw ApiError.conflict('Category already exists', 'CATEGORY_EXISTS');

  const cat = await Category.create({ businessId, name: normalizedName, description: description || '' });
  return cat;
}

async function updateCategory(businessId, id, updates) {
  const cat = await getCategory(businessId, id);
  if (updates.name !== undefined) {
    const nextName = String(updates.name).trim();
    if (!nextName) throw ApiError.badRequest('Category name is required', 'MISSING_FIELDS');
    if (nextName.toLowerCase() !== cat.name.toLowerCase()) {
      const exists = await Category.exists({
        businessId,
        _id: { $ne: cat._id },
        name: new RegExp(`^${nextName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
      if (exists) throw ApiError.conflict('Category already exists', 'CATEGORY_EXISTS');
    }
    cat.name = nextName;
  }
  if (updates.description !== undefined) cat.description = String(updates.description).trim();
  await cat.save();
  return cat;
}

/**
 * Soft-deletes (deactivates) a category. Products referencing it are detached
 * so their snapshots stay valid in historical bills.
 */
async function deactivateCategory(businessId, id) {
  const cat = await getCategory(businessId, id);
  cat.isActive = false;
  await cat.save();
  await Product.updateMany({ businessId, categoryId: cat._id }, { $set: { categoryId: null } });
  return cat;
}

/**
 * Permanently deletes a category. Refuses if any active product still points to
 * it, so the owner must first move or deactivate those products.
 */
async function hardDeleteCategory(businessId, id) {
  const cat = await getCategory(businessId, id);
  const inUse = await Product.exists({ businessId, categoryId: cat._id });
  if (inUse) {
    throw ApiError.conflict(
      'This category still has products assigned. Move or deactivate them first.',
      'CATEGORY_IN_USE'
    );
  }
  await Category.deleteOne({ _id: cat._id, businessId });
  return cat;
}

module.exports = { listCategories, getCategory, createCategory, updateCategory, deactivateCategory, hardDeleteCategory };