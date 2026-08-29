'use strict';

const { success, created } = require('../utils/ApiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const categoryService = require('../services/categoryService');

/**
 * GET /api/categories — tenant-scoped.
 */
const listCategories = asyncHandler(async (req, res) => {
  const data = await categoryService.listCategories(req.businessId, {
    includeInactive: req.query.includeInactive === 'true',
  });
  return success(res, { categories: data }, 'Categories retrieved');
});

const createCategory = asyncHandler(async (req, res) => {
  const cat = await categoryService.createCategory(req.businessId, req.body);
  return created(res, { category: cat.toSafeJSON() }, 'Category created');
});

const updateCategory = asyncHandler(async (req, res) => {
  const cat = await categoryService.updateCategory(req.businessId, req.params.id, req.body);
  return success(res, { category: cat.toSafeJSON() }, 'Category updated');
});

const deleteCategory = asyncHandler(async (req, res) => {
  const cat = await categoryService.deactivateCategory(req.businessId, req.params.id);
  return success(res, { category: cat.toSafeJSON() }, 'Category deactivated');
});

/** DELETE /api/categories/:id/permanent — hard delete (refuses if products use it). */
const permanentDeleteCategory = asyncHandler(async (req, res) => {
  await categoryService.hardDeleteCategory(req.businessId, req.params.id);
  return success(res, { ok: true }, 'Category permanently deleted');
});

module.exports = { listCategories, createCategory, updateCategory, deleteCategory, permanentDeleteCategory };