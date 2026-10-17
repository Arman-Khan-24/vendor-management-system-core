export type UserRole = 'OWNER' | 'STAFF' | 'DELIVERY';
export interface User {
    id: string;
    business_id: string;
    name: string;
    email: string;
    password_hash: string;
    role: UserRole;
    created_at: Date;
    updated_at: Date;
}
export interface Business {
    id: string;
    name: string;
    slug: string;
    category_template: string | null;
    phone: string | null;
    currency: string;
    logo_url: string | null;
    invoice_trigger: 'Packed' | 'Delivered';
    created_at: Date;
    updated_at: Date;
}
export interface Customer {
    id: string;
    business_id: string;
    name: string;
    phone: string;
    credit_terms_days: number;
    active: boolean;
    created_at: Date;
    updated_at: Date;
}
export interface Product {
    id: string;
    business_id: string;
    name: string;
    unit: string;
    current_price: number;
    active: boolean;
    created_at: Date;
    updated_at: Date;
}
export type OrderStatus = 'Received' | 'Packed' | 'Delivered';
export type OrderSource = 'manual' | 'whatsapp_text' | 'whatsapp_image';
export interface Order {
    id: string;
    business_id: string;
    customer_id: string;
    order_no: number;
    status: OrderStatus;
    source: OrderSource;
    notes: string | null;
    created_by: string | null;
    created_at: Date;
    confirmed_at: Date | null;
    packed_at: Date | null;
    delivered_at: Date | null;
}
export interface OrderItem {
    id: string;
    business_id: string;
    order_id: string;
    product_id: string;
    quantity: number;
    unit: string;
    unit_price_at_order: number;
    total_price: number;
}
export interface OrderStatusHistory {
    id: string;
    business_id: string;
    order_id: string;
    from_status: OrderStatus | null;
    to_status: OrderStatus;
    changed_by: string | null;
    changed_at: Date;
}
export type InvoiceStatus = 'Pending' | 'Partial' | 'Paid';
export interface Invoice {
    id: string;
    business_id: string;
    order_id: string;
    customer_id: string;
    invoice_no: number;
    subtotal: number;
    tax: number;
    total: number;
    status: InvoiceStatus;
    pdf_url: string | null;
    created_at: Date;
}
export type PaymentMode = 'cash' | 'upi' | 'bank_transfer' | 'cheque';
export interface Payment {
    id: string;
    business_id: string;
    customer_id: string;
    amount: number;
    mode: PaymentMode;
    date: string;
    reference: string | null;
    notes: string | null;
    created_by: string | null;
    created_at: Date;
}
export interface PaymentAllocation {
    id: string;
    business_id: string;
    payment_id: string;
    invoice_id: string;
    amount: number;
    created_at: Date;
}
