'use strict';

const { z } = require('zod');

/**
 * Zod schemas for category & product payloads and list filters.
 * Tax rate is a percentage (0-100); 0 means exempt — never a hard-coded rate.
 */

const categoryIdSchema = z
  .string()
  .trim()
  .max(40)
  .optional()
  .or(z.literal(''))
  .or(z.null());

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(80),
  description: z.string().trim().max(300).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
});

const listCategoriesQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});

const productBaseSchema = {
  name: z.string().trim().min(1, 'Product name is required').max(160),
  categoryId: categoryIdSchema,
  sku: z.string().trim().max(40).optional(),
  barcode: z.string().trim().max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().trim().max(500).optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  hsnCode: z.string().trim().max(20).optional(),
  stockEnabled: z.boolean().optional(),
  currentStock: z.coerce.number().min(0).optional(),
  minimumStock: z.coerce.number().min(0).optional(),
  unit: z.string().trim().max(12).optional(),
};

const createProductSchema = z.object(productBaseSchema);

const updateProductSchema = z.object({ ...productBaseSchema, isActive: z.boolean().optional() }).partial();

const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(40).optional(),
  active: z.enum(['true', 'false', 'all']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
};