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
  logo_url?: string | null;
  settings?: BusinessSettings;
}

export type Accent = 'sage' | 'lavender' | 'peach' | 'sky';
export type Theme = 'light' | 'dark' | 'system';
export interface BusinessSettings {
  branding: { appName: string; tagline: string; accent: Accent; theme: Theme };
  profile: { address: string; email: string; taxId: string };
  catalog: { productLabel: string; customerLabel: string; defaultUnit: string; units: string[]; categories: string[] };
  billing: { invoicePrefix: string; defaultCreditTermsDays: number; paymentMethods: PaymentMode[]; taxRate: number; footer: string };
  modules: { reports: boolean; payments: boolean };
}

export interface ProviderConnection {
  provider: 'openai' | 'gemini' | 'groq' | 'custom';
  endpoint: string;
  model: string;
  hasApiKey: boolean;
}
export interface Connections { primary: ProviderConnection; fallback: ProviderConnection }
export interface BusinessUpdate {
  name: string; phone: string; currency: string; logoUrl: string;
  invoiceTrigger: 'Packed' | 'Delivered'; categoryTemplate: string;
  settings: BusinessSettings;
}
export type BusinessPatch = Partial<Omit<BusinessUpdate, 'settings'>> & {
  settings?: { [K in keyof BusinessSettings]?: Partial<BusinessSettings[K]> };
};
export interface ProductInput { name: string; unit: string; currentPrice: number; category?: string }
export interface CustomerInput { name: string; phone: string; creditTermsDays: number }
export interface OrderInput { customerId: string; notes?: string; items: { productId: string; quantity: number }[] }
export interface PaymentInput { customerId: string; amount: number; mode: PaymentMode; date: string; reference?: string; notes?: string }

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
  active: boolean;
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
  category?: string | null;
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
  subtotal?: number;
  tax?: number;
  tax_rate?: number;
  invoice_prefix?: string;
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
  invoice_prefix?: string;
  order_id: string;
  order_no?: number;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  subtotal: number;
  tax: number;
  status: InvoiceStatus;
  allocated_amount: number;
  paid_amount?: number;
  remaining_amount: number;
  tax_rate?: number;
  credit_terms_days?: number;
  billing_footer?: string;
  items?: Array<{ product_name: string; quantity: number; unit: string; unit_price: number; total: number }>;
  created_at: string;
}

export interface Payment {
  id: string;
  customer_id: string;
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
