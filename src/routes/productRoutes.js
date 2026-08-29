'use strict';

const express = require('express');

const { authenticateToken } = require('../middleware/authMiddleware');
const { requireTenant } = require('../middleware/tenantMiddleware');
const { requireBusinessOwner } = require('../middleware/roleMiddleware');
const { validate } = require('../middleware/validationMiddleware');
const {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
} = require('../validators/productValidators');
const productController = require('../controllers/productController');

const router = express.Router();

// Owner-scoped.
router.use(authenticateToken, requireTenant, requireBusinessOwner);

router.get('/', validate(listProductsQuerySchema, 'query'), productController.listProducts);
router.post('/', validate(createProductSchema), productController.createProduct);
router.get('/low', productController.listLowStock);
router.get('/:id', productController.getProduct);
router.put('/:id', validate(updateProductSchema), productController.updateProduct);
router.delete('/:id', productController.deleteProduct);
router.delete('/:id/permanent', productController.permanentDeleteProduct);

module.exports = router;