-- Owner-managed public configuration is isolated from provider credentials.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS business_connections (
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    slot VARCHAR(10) NOT NULL CHECK (slot IN ('primary', 'fallback')),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('openai', 'gemini', 'groq', 'custom')),
    endpoint VARCHAR(2048) NOT NULL DEFAULT '',
    model VARCHAR(150) NOT NULL DEFAULT '',
    api_key_encrypted TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_id, slot)
);
