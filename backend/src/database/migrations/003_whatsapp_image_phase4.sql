-- Migration 003: WhatsApp Image Ingestion & Vision Auditing
-- Phase 4 Schema Additions

-- 1. Add media tracking columns to whatsapp_messages
ALTER TABLE whatsapp_messages 
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS media_mime_type VARCHAR(100);

-- 2. Add media columns to pending_order_confirmations
ALTER TABLE pending_order_confirmations
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) NOT NULL DEFAULT 'whatsapp_text' CHECK (source_type IN ('whatsapp_text', 'whatsapp_image')),
    ADD COLUMN IF NOT EXISTS media_url TEXT;

-- 3. Add input_type and media_url to ai_extraction_audits
ALTER TABLE ai_extraction_audits
    ADD COLUMN IF NOT EXISTS input_type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (input_type IN ('text', 'image')),
    ADD COLUMN IF NOT EXISTS media_url TEXT;
