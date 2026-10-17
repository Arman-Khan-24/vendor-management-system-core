const API_BASE = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '') + '/api';

export class ApiClient {
  private static getToken(): string | null {
    return localStorage.getItem('orderledger_token');
  }

  static setToken(token: string) {
    localStorage.setItem('orderledger_token', token);
  }

  static clearToken() {
    localStorage.removeItem('orderledger_token');
  }

  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        this.clearToken();
      }
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    return data as T;
  }

  // Auth
  static login(body: any) {
    return this.request<{ token: string; user: any; business: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  static register(body: any) {
    return this.request<{ token: string; user: any; business: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  static getMe() {
    return this.request<{ user: any; business: any }>('/auth/me');
  }

  static getTemplates() {
    return this.request<{ templates: any[] }>('/auth/templates');
  }

  // Dashboard
  static getDashboard() {
    return this.request<any>('/dashboard/summary');
  }

  // Orders
  static getOrders(params?: { status?: string; customerId?: string }) {
    const query = new URLSearchParams(params as any).toString();
    return this.request<any[]>(`/orders${query ? `?${query}` : ''}`);
  }

  static getOrder(id: string) {
    return this.request<any>(`/orders/${id}`);
  }

  static createOrder(body: any) {
    return this.request<any>('/orders', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  static updateOrderStatus(id: string, status: string) {
    return this.request<any>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }

  // Customers
  static getCustomers(search?: string) {
    return this.request<any[]>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  }

  static getCustomer(id: string) {
    return this.request<any>(`/customers/${id}`);
  }

  static createCustomer(body: any) {
    return this.request<any>('/customers', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  static getCustomerStatement(id: string, params?: { startDate?: string; endDate?: string }) {
    const q = new URLSearchParams(params as any).toString();
    return this.request<any>(`/reports/statement/${id}${q ? `?${q}` : ''}`);
  }

  static async downloadCustomerStatementPdf(id: string, params?: { startDate?: string; endDate?: string }, customerName?: string) {
    const token = this.getToken();
    const q = new URLSearchParams(params as any).toString();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/reports/statement/${id}/pdf${q ? `?${q}` : ''}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to generate PDF statement (${res.status})`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (customerName || 'Statement').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `Statement_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  // Reports
  static getDuesReport(asOfDate?: string) {
    return this.request<any>(`/reports/dues${asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : ''}`);
  }

  static getSalesReport(params?: { startDate?: string; endDate?: string; interval?: 'day' | 'week' | 'month' }) {
    const q = new URLSearchParams(params as any).toString();
    return this.request<any>(`/reports/sales${q ? `?${q}` : ''}`);
  }

  static getCollectionReport(params?: { startDate?: string; endDate?: string; interval?: 'day' | 'week' | 'month' }) {
    const q = new URLSearchParams(params as any).toString();
    return this.request<any>(`/reports/collections${q ? `?${q}` : ''}`);
  }

  static getTopCustomers(params?: { limit?: number; startDate?: string; endDate?: string }) {
    const q = new URLSearchParams(params as any).toString();
    return this.request<any[]>(`/reports/top-customers${q ? `?${q}` : ''}`);
  }

  static getTopProducts(params?: { limit?: number; startDate?: string; endDate?: string }) {
    const q = new URLSearchParams(params as any).toString();
    return this.request<any[]>(`/reports/top-products${q ? `?${q}` : ''}`);
  }

  // Products
  static getProducts(search?: string) {
    return this.request<any[]>(`/products${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  }

  static createProduct(body: any) {
    return this.request<any>('/products', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // Invoices
  static getInvoices() {
    return this.request<any[]>('/invoices');
  }

  // Payments
  static getPayments() {
    return this.request<any[]>('/payments');
  }

  static recordPayment(body: any) {
    return this.request<any>('/payments', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }
}
