'use strict';

const paymentService = require('../services/paymentService');
const auditService = require('../services/auditService');
const { success } = require('../utils/ApiResponse');

/**
 * POST /api/payments/webhook — Razorpay server-to-server notification.
 *
 * Verifies the HMAC signature over the raw body, then resolves the Payment
 * from the link's reference_id (format: billmitra_<paymentId>) and
 * runs the same idempotent activate path as owner-side polling. Always
 * answers 200 so Razorpay does not retry a handled event.
 */
const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature || !paymentService.verifyWebhookSignature(req.body, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = JSON.parse(req.body.toString('utf8'));
    const type = event?.event || '';
    const entity = event?.payload?.payment_link?.entity || event?.payload?.payment?.entity || null;
    const referenceId = entity?.reference_id || '';
    // billmitra_<paymentId> (current) — also tolerate the legacy billmitra|<biz>|<id>.
    let paymentIdFromRef = null;
    if (referenceId.startsWith('billmitra_')) paymentIdFromRef = referenceId.slice('billmitra_'.length);
    else if (referenceId.startsWith('billmitra|')) paymentIdFromRef = referenceId.split('|')[2] || null;

    if (type === 'payment_link.paid' && paymentIdFromRef) {
      await paymentService.syncAndActivateIfPaid(paymentIdFromRef);
      await auditService.logAudit({
        actorRole: 'SYSTEM',
        action: 'PAYMENT_WEBHOOK_PROCESSED',
        entityType: 'Payment',
        entityId: paymentIdFromRef,
        metadata: { provider: 'RAZORPAY', event: type },
      });
    }

    return success(res, { received: true }, 'Webhook processed');
  } catch (err) {
    // Never leak internals to the provider; log via error handler is skipped
    // because Razorpay only needs the status code.
    console.error('[webhook] processing failed:', err.message);
    return res.status(500).json({ success: false });
  }
};

module.exports = { handleWebhook };
