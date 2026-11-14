-- 002: "Borrow against BTC and pay" — settlements funded by a Mezo trove.
-- The payer signs WithdrawMUSD(amount, borrower=payer, recipient=creditor) and sends
-- BorrowerOperationsSignatures.withdrawMUSDWithSignature: MUSD is minted from the payer's own trove
-- straight to the creditor. Verified server-side from the receipt (TroveUpdated + mint Transfer).
-- Idempotent: safe to re-run.

ALTER TABLE split.settlements DROP CONSTRAINT IF EXISTS settlements_method_check;
ALTER TABLE split.settlements ADD CONSTRAINT settlements_method_check
  CHECK (method IN ('direct', 'contract', 'contract_permit', 'trove', 'batch', 'batch_permit'));
