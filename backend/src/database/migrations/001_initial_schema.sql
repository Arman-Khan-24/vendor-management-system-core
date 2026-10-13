-- Migration 001: Initial OrderLedger Multi-Tenant Schema
-- PostgreSQL DDL (PostgreSQL 13+ includes gen_random_uuid natively in core)
DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
END $$;


-- 1. Category Templates (Global blueprints)
CREATE TABLE IF NOT EXISTS category_templates (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    seed_products JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tenants (Businesses)
CREATE TABLE IF NOT EXISTS businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    category_template VARCHAR(50) REFERENCES category_templates(id),
    phone VARCHAR(25),
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    logo_url TEXT,
    invoice_trigger VARCHAR(20) NOT NULL DEFAULT 'Delivered' CHECK (invoice_trigger IN ('Packed', 'Delivered')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_businesses_id UNIQUE (id)
);

-- 3. Users (Strictly scoped to business_id)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'STAFF', 'DELIVERY')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_business_email UNIQUE (business_id, email),
    CONSTRAINT uq_users_business_user UNIQUE (business_id, id)
);
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);

-- 4. Customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    credit_terms_days INT NOT NULL DEFAULT 7,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customers_business_phone UNIQUE (business_id, phone),
    CONSTRAINT uq_customers_business_customer UNIQUE (business_id, id)
);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);

-- 5. Products (Tenant Catalog)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    current_price NUMERIC(12, 2) NOT NULL CHECK (current_price >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_products_business_name UNIQUE (business_id, name),
    CONSTRAINT uq_products_business_product UNIQUE (business_id, id)
);
CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);

-- 6. Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL,
    order_no INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Received' CHECK (status IN ('Received', 'Packed', 'Delivered')),
    source VARCHAR(30) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'whatsapp_text', 'whatsapp_image')),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    packed_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    CONSTRAINT uq_orders_business_order_no UNIQUE (business_id, order_no),
    CONSTRAINT uq_orders_business_order UNIQUE (business_id, id),
    CONSTRAINT fk_orders_customer_same_business FOREIGN KEY (business_id, customer_id)
        REFERENCES customers(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_orders_user_same_business FOREIGN KEY (business_id, created_by)
        REFERENCES users(business_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_business_status ON orders(business_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_business_customer ON orders(business_id, customer_id);

-- 7. Order Items (CRITICAL: unit_price_at_order captures frozen price snapshot)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    order_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit VARCHAR(50) NOT NULL,
    unit_price_at_order NUMERIC(12, 2) NOT NULL CHECK (unit_price_at_order >= 0),
    total_price NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * unit_price_at_order) STORED,
    CONSTRAINT fk_order_items_order_same_business FOREIGN KEY (business_id, order_id)
        REFERENCES orders(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product_same_business FOREIGN KEY (business_id, product_id)
        REFERENCES products(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_business ON order_items(business_id);

-- 8. Order Status History (Audit trail for timeline)
CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    order_id UUID NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL CHECK (to_status IN ('Received', 'Packed', 'Delivered')),
    changed_by UUID,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_order_status_history_order FOREIGN KEY (business_id, order_id)
        REFERENCES orders(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_order_status_history_user FOREIGN KEY (business_id, changed_by)
        REFERENCES users(business_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);

-- 9. Invoices (Sequential per tenant: INV-0001, etc.)
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    order_id UUID NOT NULL UNIQUE,
    customer_id UUID NOT NULL,
    invoice_no INT NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Partial', 'Paid')),
    pdf_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invoices_business_invoice_no UNIQUE (business_id, invoice_no),
    CONSTRAINT uq_invoices_business_invoice UNIQUE (business_id, id),
    CONSTRAINT fk_invoices_order_same_business FOREIGN KEY (business_id, order_id)
        REFERENCES orders(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_invoices_customer_same_business FOREIGN KEY (business_id, customer_id)
        REFERENCES customers(business_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_invoices_business_customer ON invoices(business_id, customer_id);

-- 10. Payments (Customer Account level)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    mode VARCHAR(30) NOT NULL DEFAULT 'cash' CHECK (mode IN ('cash', 'upi', 'bank_transfer', 'cheque')),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference VARCHAR(100),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payments_business_payment UNIQUE (business_id, id),
    CONSTRAINT fk_payments_customer_same_business FOREIGN KEY (business_id, customer_id)
        REFERENCES customers(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_payments_user_same_business FOREIGN KEY (business_id, created_by)
        REFERENCES users(business_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_business_customer ON payments(business_id, customer_id);

-- 11. Payment Allocations (Persistent FIFO & Specific Allocation Table)
CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL,
    invoice_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_allocations_payment_same_business FOREIGN KEY (business_id, payment_id)
        REFERENCES payments(business_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_allocations_invoice_same_business FOREIGN KEY (business_id, invoice_id)
        REFERENCES invoices(business_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_allocations_business ON payment_allocations(business_id);

-- 12. Seed Default Global Category Templates
INSERT INTO category_templates (id, name, description, seed_products)
SELECT 'fruits_veg', 'Fruits & Vegetables', 'Standard fresh produce catalog for suppliers serving restaurants and resorts',
'[{"name": "Tomato (Hybrid)", "unit": "kg", "current_price": 40.00}, {"name": "Potato (Jyoti)", "unit": "kg", "current_price": 30.00}, {"name": "Onion (Nashik)", "unit": "kg", "current_price": 35.00}, {"name": "Green Chilli", "unit": "kg", "current_price": 60.00}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM category_templates WHERE id = 'fruits_veg');

INSERT INTO category_templates (id, name, description, seed_products)
SELECT 'grocery', 'Grocery & Staples', 'Wholesale staples, spices, flours and oils',
'[{"name": "Basmati Rice (Classic)", "unit": "kg", "current_price": 95.00}, {"name": "Toor Dal (Premium)", "unit": "kg", "current_price": 160.00}, {"name": "Sunflower Oil (15L)", "unit": "tin", "current_price": 1850.00}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM category_templates WHERE id = 'grocery');

INSERT INTO category_templates (id, name, description, seed_products)
SELECT 'dairy', 'Dairy & Eggs', 'Fresh milk, paneer, curd, butter, and commercial eggs',
'[{"name": "Full Cream Milk", "unit": "litre", "current_price": 66.00}, {"name": "Fresh Malai Paneer", "unit": "kg", "current_price": 340.00}, {"name": "Table Eggs (30 Tray)", "unit": "tray", "current_price": 190.00}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM category_templates WHERE id = 'dairy');

INSERT INTO category_templates (id, name, description, seed_products)
SELECT 'custom', 'General Wholesale / Custom', 'Clean empty slate for custom wholesale operations', '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM category_templates WHERE id = 'custom');

