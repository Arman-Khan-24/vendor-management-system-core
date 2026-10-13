export type OrderStatus = 'Received' | 'Packed' | 'Delivered';
export type InvoiceStatus = 'Pending' | 'Partial' | 'Paid';
export type PaymentMode = 'cash' | 'upi' | 'bank_transfer' | 'cheque';

export interface Business {
  id: string;
  name: string;
  slug: string;
  category_template: string | null;
  phone: string | null;
  currency: string;
  invoice_trigger: 'Packed' | 'Delivered';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'STAFF' | 'DELIVERY';
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  credit_terms_days: number;
  total_billed?: number;
  total_paid?: number;
  outstanding_balance?: number;
  last_order_date?: string | null;
  last_payment_date?: string | null;
}

export interface Product {
  id: string;
  name: string;
  unit: string;
  current_price: number;
  active: boolean;
}

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price_at_order: number;
  total_price: number;
}

export interface OrderStatusHistory {
  id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by: string | null;
  changed_at: string;
}

export interface Order {
  id: string;
  order_no: number;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  source: 'manual' | 'whatsapp_text' | 'whatsapp_image';
  total_amount: number;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  packed_at: string | null;
  delivered_at: string | null;
  items?: OrderItem[];
  history?: OrderStatusHistory[];
  invoice_id?: string | null;
  invoice_no?: number | null;
  invoice_status?: InvoiceStatus | null;
}

export interface Invoice {
  id: string;
  invoice_no: number;
  customer_name: string;
  customer_phone: string;
  total: number;
  subtotal: number;
  tax: number;
  status: InvoiceStatus;
  allocated_amount: number;
  remaining_amount: number;
  created_at: string;
}

export interface Payment {
  id: string;
  customer_name: string;
  amount: number;
  mode: PaymentMode;
  date: string;
  reference: string | null;
  notes: string | null;
  allocations?: Array<{
    invoice_no: number;
    amount: number;
  }>;
}

export interface DashboardSummary {
  todaySales: number;
  todayOrdersCount: number;
  todayCollected: number;
  totalOutstanding: number;
  totalCollected: number;
  totalOverdue?: number;
  agingBuckets?: {
    current: number;
    overdue_1_7: number;
    overdue_8_15: number;
    overdue_16_30: number;
    overdue_30_plus: number;
  };
  statusCounts: {
    Received: number;
    Packed: number;
    Delivered: number;
  };
  overdueCustomers: Array<{
    id: string;
    name: string;
    phone: string;
    balance: number;
    overdueAmount?: number;
    creditTermsDays: number;
    oldestInvoiceDate: string;
  }>;
  salesTrend?: Array<{
    period: string;
    orderCount: number;
    salesAmount: number;
  }>;
  collectionTrend?: Array<{
    period: string;
    paymentCount: number;
    collectedAmount: number;
  }>;
  topCustomers?: Array<{
    id: string;
    name: string;
    phone: string;
    orderCount: number;
    totalSales: number;
    totalPaid: number;
    outstandingBalance: number;
  }>;
  topProducts?: Array<{
    id: string;
    name: string;
    unit: string;
    currentPrice: number;
    orderFrequency: number;
    totalQuantitySold: number;
    totalRevenue: number;
  }>;
}
