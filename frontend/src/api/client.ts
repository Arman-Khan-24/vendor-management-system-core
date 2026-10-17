import type { Business, BusinessUpdate, Connections, Customer, CustomerInput, DashboardSummary, Invoice, Order, OrderInput, Payment, PaymentInput, Product, ProductInput, ProviderConnection, User } from '../types';
import { downloadFile } from '../utils/formatters';

const TOKEN_KEY = 'orderledger_token';
const CONNECTION_KEY = 'orderledger_api_url';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function normalizeApiUrl(value: string): string {
  const clean = value.trim().replace(/\/+$/, '');
  if (!clean || clean === '/api') return '';
  let url: URL;
  try { url = new URL(clean); } catch { throw new Error('Enter a full API address, such as https://api.example.com.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS URL without passwords, query parameters, or fragments.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Use HTTPS for a remote server. HTTP is only supported on localhost.');
  }
  return url.toString().replace(/\/+$/, '').replace(/\/api$/i, '');
}
function queryString(params: Record<string, unknown> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, String(value)); });
  return query.size ? '?' + query.toString() : '';
}
export class ApiClient {
  static hasToken() { return !!localStorage.getItem(TOKEN_KEY); }
  static setToken(token: string) { localStorage.setItem(TOKEN_KEY, token); }
  static clearToken() { localStorage.removeItem(TOKEN_KEY); }
  static getConnection(): string { return localStorage.getItem(CONNECTION_KEY) ?? (import.meta.env.VITE_API_URL || ''); }
  static getBase(): string { return normalizeApiUrl(this.getConnection()) + '/api'; }
  static setConnection(value: string) {
    const normalized = normalizeApiUrl(value);
    this.clearToken();
    localStorage.setItem(CONNECTION_KEY, normalized);
    window.dispatchEvent(new Event('orderledger:connection'));
  }
  static async testConnection(value: string) {
    const base = normalizeApiUrl(value);
    const response = await fetch(base + '/api/auth/templates', { signal: AbortSignal.timeout(10000), credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Server returned ' + response.status + '. Check the address and database connection.');
    const data = await response.json();
    if (!Array.isArray(data.templates)) throw new Error('This address did not return an OrderLedger API response.');
    return true;
  }
  private static async response(endpoint: string, options: RequestInit = {}) {
    const base = this.getBase();
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', 'Bearer ' + token);
    let response: Response;
    try {
      response = await fetch(base + endpoint, { ...options, headers, credentials: 'omit', redirect: 'error', signal: options.signal || AbortSignal.timeout(20000) });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new ApiError('The server took too long to respond. Check your connection, then refresh before retrying a save.', 0);
      throw new ApiError('Cannot reach the server. Check your internet connection and API address in Connections.', 0);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && token && !endpoint.startsWith('/auth/')) {
        this.clearToken();
        window.dispatchEvent(new Event('orderledger:unauthorized'));
      }
      let message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : 'Request failed (' + response.status + ').';
      if (data.details && Array.isArray(data.details)) {
        message += ' ' + data.details.map((d: { message?: string; path?: string[] }) => [d.path?.join('.'), d.message].filter(Boolean).join(': ')).join('. ');
      }
      throw new ApiError(message, response.status);
    }
    return response;
  }
  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await this.response(endpoint, options);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new ApiError('The server returned an unreadable response. Check the API address.', response.status); }
  }
  private static write<T>(endpoint: string, body: unknown, method = 'POST') { return this.request<T>(endpoint, { method, body: JSON.stringify(body) }); }
  private static async listAll<T extends { id: string }>(endpoint: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const records: T[] = [];
    const seen = new Set<string>();
    const base = this.getBase();
    const token = localStorage.getItem(TOKEN_KEY);
    for (let offset = 0; ; offset += 500) {
      if (this.getBase() !== base || localStorage.getItem(TOKEN_KEY) !== token) throw new ApiError('Your session changed. Please reload the workspace.', 0);
      const page = await this.request<T[]>(endpoint + queryString({ ...params, limit: 500, offset }));
      if (!Array.isArray(page)) throw new ApiError('The server returned an invalid record list.', 0);
      const previousCount = records.length;
      for (const row of page) {
        if (!seen.has(row.id)) { records.push(row); seen.add(row.id); }
      }
      if (page.length < 500) return records;
      if (records.length === previousCount) throw new ApiError('The server could not load the next page. Refresh and try again.', 0);
    }
  }
  static login(body: { email: string; password: string }) { return this.write<{ token: string; user: User; business: Business }>('/auth/login', body); }
  static register(body: { businessName: string; businessSlug: string; categoryTemplate: string; phone?: string; ownerName: string; email: string; password: string }) { return this.write<{ token: string; user: User; business: Business }>('/auth/register', body); }
  static getMe() { return this.request<{ user: User; business: Business }>('/auth/me'); }
  static getTemplates() { return this.request<{ templates: { id: string; name: string }[] }>('/auth/templates'); }
  static getBusiness() { return this.request<Business>('/business'); }
  static updateBusiness(body: BusinessUpdate) { return this.write<Business>('/business', body, 'PATCH'); }
  static getConnections() { return this.request<Connections>('/business/connections'); }
  static updateConnections(body: Partial<Record<'primary' | 'fallback', Partial<Omit<ProviderConnection, 'hasApiKey'>> & { apiKey?: string }>>) { return this.write<Connections>('/business/connections', body, 'PATCH'); }
  static getDashboard() { return this.request<DashboardSummary>('/dashboard/summary'); }
  static getOrders(params?: { status?: string; customerId?: string }) { return this.listAll<Order>('/orders', params); }
  static getOrder(id: string) { return this.request<Order>('/orders/' + id); }
  static createOrder(body: OrderInput) { return this.write<Order>('/orders', body); }
  static updateOrderStatus(id: string, status: string) { return this.write<Order>('/orders/' + id + '/status', { status }, 'PATCH'); }
  static getCustomers(search?: string) { return this.listAll<Customer>('/customers', { search, all: true }); }
  static getCustomer(id: string) { return this.request<Customer>('/customers/' + id); }
  static createCustomer(body: CustomerInput) { return this.write<Customer>('/customers', body); }
  static updateCustomer(id: string, body: Partial<CustomerInput> & { active?: boolean }) { return this.write<Customer>('/customers/' + id, body, 'PATCH'); }
  static getCustomerStatement(id: string, params?: { startDate?: string; endDate?: string }) { return this.request<any>('/reports/statement/' + id + queryString(params)); }
  static async downloadCustomerStatementPdf(id: string, params?: { startDate?: string; endDate?: string }, name = 'Customer') {
    const response = await this.response('/reports/statement/' + id + '/pdf' + queryString(params));
    downloadFile(await response.blob(), 'Statement_' + name.replace(/[^\p{L}\p{N}_-]/gu, '_') + '.pdf', 'application/pdf');
  }
  static getDuesReport(asOfDate?: string) { return this.request<any>('/reports/dues' + queryString({ asOfDate })); }
  static getSalesReport(params?: { startDate?: string; endDate?: string; interval?: 'day' | 'week' | 'month' }) { return this.request<any>('/reports/sales' + queryString(params)); }
  static getCollectionReport(params?: { startDate?: string; endDate?: string; interval?: 'day' | 'week' | 'month' }) { return this.request<any>('/reports/collections' + queryString(params)); }
  static getTopCustomers(params?: { limit?: number; startDate?: string; endDate?: string }) { return this.request<any[]>('/reports/top-customers' + queryString(params)); }
  static getTopProducts(params?: { limit?: number; startDate?: string; endDate?: string }) { return this.request<any[]>('/reports/top-products' + queryString(params)); }
  static getProducts(search?: string) { return this.listAll<Product>('/products', { search, all: true }); }
  static createProduct(body: ProductInput) { return this.write<Product>('/products', body); }
  static updateProduct(id: string, body: Partial<ProductInput> & { active?: boolean }) { return this.write<Product>('/products/' + id, body, 'PATCH'); }
  static getInvoices(params?: { status?: string }) { return this.listAll<Invoice>('/invoices', params); }
  static getInvoice(id: string) { return this.request<Invoice & { items?: any[] }>('/invoices/' + id); }
  static getPayments() { return this.listAll<Payment>('/payments'); }
  static recordPayment(body: PaymentInput) { return this.write<Payment>('/payments', body); }
}
