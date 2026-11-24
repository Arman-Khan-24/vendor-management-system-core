ALTER TABLE whatsapp_messages ADD COLUMN sent_at timestamptz;
-- Old summaries require a fresh confirmation after rollout.
UPDATE pending_order_confirmations SET status='expired' WHERE status='pending_confirmation';
