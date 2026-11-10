-- Durable inbox/outbox; one queue shared by the API and an optional worker process.
CREATE TABLE whatsapp_connections (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  phone_number_id VARCHAR(50) NOT NULL DEFAULT '',
  waba_id VARCHAR(50) NOT NULL DEFAULT '',
  graph_version VARCHAR(20) NOT NULL DEFAULT '',
  default_country_code VARCHAR(4) NOT NULL DEFAULT '91',
  access_token_encrypted TEXT,
  app_secret_encrypted TEXT,
  verify_token_encrypted TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE whatsapp_messages ADD COLUMN delivery_status VARCHAR(30);
ALTER TABLE whatsapp_messages ADD COLUMN provider_timestamp TIMESTAMPTZ;
ALTER TABLE whatsapp_messages ADD COLUMN error_code VARCHAR(100);
ALTER TABLE whatsapp_messages ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pending_order_confirmations ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes');
ALTER TABLE pending_order_confirmations ADD COLUMN quote_context JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Old unconfirmed drafts must not become actionable when integration is enabled.
UPDATE pending_order_confirmations SET status = 'expired' WHERE status = 'pending_confirmation';
CREATE UNIQUE INDEX uq_pending_active_customer ON pending_order_confirmations(business_id, customer_id) WHERE status = 'pending_confirmation';

CREATE TABLE whatsapp_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence BIGSERIAL UNIQUE NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  sender_phone VARCHAR(25) NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK(kind IN ('inbound', 'outbound')),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  lease_token UUID,
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(message_id, kind)
);
CREATE INDEX idx_whatsapp_jobs_ready ON whatsapp_jobs(available_at, created_at) WHERE status IN ('queued','processing');
CREATE INDEX idx_whatsapp_jobs_customer ON whatsapp_jobs(business_id, sender_phone, created_at);
CREATE INDEX idx_whatsapp_messages_customer_time ON whatsapp_messages(business_id, sender_phone, provider_timestamp DESC);
CREATE TABLE whatsapp_delivery_receipts (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_message_id VARCHAR(150) NOT NULL,
  delivery_status VARCHAR(30) NOT NULL,
  error_code VARCHAR(100),
  PRIMARY KEY(business_id,provider_message_id)
);
