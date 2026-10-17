-- Additive migration: preserve catalogs and all financial history.
ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_terms_days INT NOT NULL DEFAULT 7 CHECK (credit_terms_days BETWEEN 0 AND 365);
UPDATE orders o SET credit_terms_days = c.credit_terms_days
FROM customers c WHERE c.id = o.customer_id AND c.business_id = o.business_id;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name_at_order VARCHAR(255);
UPDATE order_items oi SET product_name_at_order = p.name
FROM products p WHERE p.id = oi.product_id AND p.business_id = oi.business_id;
ALTER TABLE order_items ALTER COLUMN product_name_at_order SET NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_prefix VARCHAR(16) NOT NULL DEFAULT 'INV';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_terms_days INT NOT NULL DEFAULT 7;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_footer TEXT NOT NULL DEFAULT '';
UPDATE invoices i SET credit_terms_days = c.credit_terms_days
FROM customers c WHERE c.id = i.customer_id AND c.business_id = i.business_id;
CREATE INDEX IF NOT EXISTS idx_payments_business_date ON payments(business_id, date);
