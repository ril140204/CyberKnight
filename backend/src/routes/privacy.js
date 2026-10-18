/**
 * CyberKnight / Sigmabloom — Privacy Request API
 *
 * TODO (Phase 3+): Implement these endpoints fully:
 *   - POST /api/privacy/request  — handle GDPR/Nghị định 13 requests:
 *       body: { type: 'access'|'rectification'|'erasure'|'withdraw_consent'|'refund', email: string, details?: string }
 *       → verify email exists in DB
 *       → send confirmation email to user
 *       → log to audit
 *       → return { ok: true, message: 'Yêu cầu đã được tiếp nhận. Chúng tôi sẽ phản hồi trong 72 giờ.' }
 *
 *   Right now this stub returns 501 so the refund form still POSTs here.
 */

'use strict';

const express = require('express');
const router = express.Router();

/**
 * Resolve privacy contact email.
 * Priority: PRIVACY_EMAIL env var > privacy@<FRONTEND_URL domain> > privacy@localhost
 */
function getPrivacyEmail() {
  if (process.env.PRIVACY_EMAIL) return process.env.PRIVACY_EMAIL;
  const frontendUrl = process.env.FRONTEND_URL || '';
  try {
    const hostname = new URL(frontendUrl).hostname;
    return `privacy@${hostname}`;
  } catch {
    return 'privacy@localhost';
  }
}

// TODO: implement with real DB + email logic
router.post('/request', (req, res) => {
  res.status(501).json({
    ok: false,
    error: 'privacy_request_endpoint_not_implemented',
    message: `Tính năng này đang được xây dựng. Vui lòng liên hệ ${getPrivacyEmail()} để được hỗ trợ.`,
  });
});

module.exports = router;
