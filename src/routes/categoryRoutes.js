'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
} = require('../validators/productValidators');
const categoryController = require('../controllers/categoryController');

const router = express.Router();

// Owner-scoped.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/', validate(listCategoriesQuerySchema, 'query'), categoryController.listCategories);
router.post('/', validate(createCategorySchema), categoryController.createCategory);
router.put('/:id', validate(updateCategorySchema), categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);
router.delete('/:id/permanent', categoryController.permanentDeleteCategory);

module.exports = router;