-- Migration 002: WhatsApp Ingestion, AI Audit & Pending Order Confirmations
-- Phase 3 Schema Additions

-- 1. Inbound WhatsApp Messages (Idempotent event log & raw message audit)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'mock',
    provider_message_id VARCHAR(150),
    sender_phone VARCHAR(25) NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    message_text TEXT,
    raw_payload JSONB,
    status VARCHAR(30) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'queued', 'processed', 'ignored', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_whatsapp_provider_msg UNIQUE (business_id, provider, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_business ON whatsapp_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_sender ON whatsapp_messages(business_id, sender_phone);

-- 2. Pending Order Confirmations (Waiting for customer YES / Correction)
CREATE TABLE IF NOT EXISTS pending_order_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    inbound_message_id UUID REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
    extracted_items JSONB NOT NULL,
    raw_text TEXT NOT NULL,
    ai_provider VARCHAR(50) NOT NULL,
    ai_model VARCHAR(100) NOT NULL,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'confirmed', 'corrected', 'expired', 'rejected')),
    created_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    correction_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_confirmations_cust ON pending_order_confirmations(business_id, customer_id, status);

-- 3. AI Extraction Audit Log (Record inferences, tokens, and fallback switches)
CREATE TABLE IF NOT EXISTS ai_extraction_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    inbound_message_id UUID REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
    primary_provider VARCHAR(50) NOT NULL,
    primary_model VARCHAR(100) NOT NULL,
    used_provider VARCHAR(50) NOT NULL,
    used_model VARCHAR(100) NOT NULL,
    was_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    success BOOLEAN NOT NULL,
    input_text TEXT NOT NULL,
    raw_response TEXT,
    structured_output JSONB,
    error_message TEXT,
    duration_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_audits_business ON ai_extraction_audits(business_id);
