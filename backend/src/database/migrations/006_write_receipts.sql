-- Kept for the lifetime of the business: expiring a receipt would make an old retry unsafe.
CREATE TABLE write_receipts (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('order', 'payment')),
  key UUID NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, operation, key)
);
