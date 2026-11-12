import type { Business, BusinessPatch, Connections, Customer, CustomerInput, DashboardSummary, Invoice, Order, OrderInput, OrderImportResult, Payment, PaymentInput, Product, ProductInput, ProviderConnection, User } from '../types';
import { downloadFile } from '../utils/formatters';
import { pendingWrite } from './pendingWrite';
import type { WhatsAppConnection,WhatsAppConnectionPatch,WhatsAppMessage } from '../types';

const TOKEN_KEY = 'orderledger_token';
const CONNECTION_KEY = 'orderledger_api_url';
const CONNECTION_TIMEOUT = 65000;

export class ApiError extends Error {
  constructor(message: string, public status: number, public requestId?: string) {
    super(message + (requestId && status >= 500 ? ' Reference: ' + requestId : ''));
  }
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
function connectionAddress(value: string): string {
  const address = normalizeApiUrl(value);
  const proxyTarget = import.meta.env.VITE_PROXY_API_URL;
  return proxyTarget && address === normalizeApiUrl(proxyTarget) ? '' : address;
}
function providerSettings(value: unknown): Connections {
  const data = value as Connections | null;
  if (!data || !['primary', 'fallback'].every(slot => {
    const provider = data[slot as keyof Connections];
    return provider && ['openai', 'gemini', 'groq', 'custom'].includes(provider.provider) && typeof provider.endpoint === 'string' && typeof provider.model === 'string' && typeof provider.hasApiKey === 'boolean';
  })) throw new ApiError('The server returned incomplete AI provider settings. Reload the connection settings and try again.', 502);
  return data;
}
function whatsappSettings(value: unknown): WhatsAppConnection {
  const data = value as WhatsAppConnection | null;
  if (!data || !['businessId', 'phoneNumberId', 'wabaId', 'graphVersion', 'defaultCountryCode'].every(key => typeof data[key as keyof WhatsAppConnection] === 'string') || !['enabled', 'hasAccessToken', 'hasAppSecret', 'hasVerifyToken'].every(key => typeof data[key as keyof WhatsAppConnection] === 'boolean')) {
    throw new ApiError('The server returned incomplete WhatsApp settings. Reload the connection settings and try again.', 502);
  }
  return data;
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
  static getConnection(): string { return connectionAddress(localStorage.getItem(CONNECTION_KEY) ?? (import.meta.env.VITE_API_URL || '')); }
  static getServerAddress(value = this.getConnection()): string { return connectionAddress(value) || normalizeApiUrl(import.meta.env.VITE_PROXY_API_URL || ''); }
  static wouldChangeServer(value: string): boolean {
    try { return this.getServerAddress(value) !== this.getServerAddress(); } catch { return true; }
  }
  static getBase(): string { return normalizeApiUrl(this.getConnection()) + '/api'; }
  static setConnection(value: string) {
    const normalized = connectionAddress(value);
    const changedServer = this.wouldChangeServer(value);
    if (changedServer) this.clearToken();
    localStorage.setItem(CONNECTION_KEY, normalized);
    if (changedServer) window.dispatchEvent(new Event('orderledger:connection'));
  }
  static async testConnection(value: string) {
    const base = connectionAddress(value);
    const probe = async (path: string) => {
      try { return await fetch(base + path, { signal: AbortSignal.timeout(CONNECTION_TIMEOUT), credentials: 'omit', redirect: 'error', cache: 'no-store' }); }
      catch (error) {
        throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'The server took too long to respond. Try again shortly.' : 'Cannot reach this server. Check the address and your internet connection, then try again.');
      }
    };
    const health = await probe('/health');
    if (!health.ok) throw new Error('Server setup is not ready (' + health.status + '). Check the API deployment and database migrations.');
    const readiness = await health.json().catch(() => null);
    if (readiness?.status !== 'ok' || readiness?.service !== 'OrderLedger Core API') throw new Error('This address did not return an OrderLedger API health response.');
    if (readiness.apiVersion !== 2 || readiness.capabilities?.idempotentWrites !== true) throw new Error('This server is running an older or incompatible OrderLedger API. Deploy the current backend before using these settings.');
    const response = await probe('/api/auth/templates');
    if (!response.ok) throw new Error('Server returned ' + response.status + '. Check the address and database connection.');
    const data = await response.json();
    if (!Array.isArray(data?.templates)) throw new Error('This address did not return an OrderLedger API response.');
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
      response = await fetch(base + endpoint, { ...options, headers, credentials: 'omit', redirect: 'error', signal: options.signal || AbortSignal.timeout(options.method && options.method !== 'GET' ? 20000 : CONNECTION_TIMEOUT) });
    } catch (error) {
      const retryHint = headers.has('Idempotency-Key') ? ' Your submission is unconfirmed. Retry with the same details; it will not be recorded twice.' : '';
      if (error instanceof Error && error.name === 'TimeoutError') throw new ApiError('The server took too long to respond.' + (retryHint || ' Check your connection, then refresh before retrying a save.'), 0);
      throw new ApiError('Cannot reach the server. Check your internet connection and server address.' + retryHint, 0);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const data = body && typeof body === 'object' ? body : {};
      if (response.status === 401 && token && !endpoint.startsWith('/auth/')) {
        this.clearToken();
        window.dispatchEvent(new Event('orderledger:unauthorized'));
      }
      let message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : 'Request failed (' + response.status + ').';
      if (data.details && Array.isArray(data.details)) {
        message += ' ' + data.details.map((d: { message?: unknown; path?: unknown } | null) => {
          const path = Array.isArray(d?.path) ? d.path.join('.') : typeof d?.path === 'string' ? d.path : '';
          return [path, typeof d?.message === 'string' ? d.message : ''].filter(Boolean).join(': ');
        }).filter(Boolean).join('. ');
      }
      const reference = response.headers.get('X-Request-ID');
      const requestId = reference && /^[a-f0-9-]{36}$/i.test(reference) ? reference : undefined;
      throw new ApiError(message, response.status, requestId);
    }
    return response;
  }
  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await this.response(endpoint, options);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new ApiError('The server returned an unreadable response. Check the API address.', response.status); }
  }
  private static write<T>(endpoint: string, body: unknown, method = 'POST') { return this.request<T>(endpoint, { method, body: JSON.stringify(body) }); }
  private static async writeOnce<T>(endpoint: string, body: unknown): Promise<T> {
    const base = this.getBase();
    const token = localStorage.getItem(TOKEN_KEY);
    let identity: { userId: string; businessId: string };
    try {
      identity = JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!identity.userId || !identity.businessId) throw new Error();
    } catch { throw new ApiError('Your session has expired. Sign in again.', 401); }
    const scope = JSON.stringify([(this.getServerAddress() || normalizeApiUrl(this.getConnection())) + '/api', identity.businessId, identity.userId, endpoint]);
    const previousScope = JSON.stringify([base, identity.businessId, identity.userId, endpoint]);
    return pendingWrite(scope, body, async key => {
      let response: Response;
      try {
        response = await fetch(base.replace(/\/api$/, '') + '/health', { signal: AbortSignal.timeout(CONNECTION_TIMEOUT), credentials: 'omit', redirect: 'error', cache: 'no-store' });
      } catch { throw new ApiError('Cannot confirm the server is ready. Your submission has not been sent. Check your connection and retry.', 0); }
      if (!response.ok) throw new ApiError('The server or database is not ready. Your submission has not been sent. Please retry shortly.', 503);
      const health = await response.json().catch(() => null);
      if (health?.service !== 'OrderLedger Core API' || health?.status !== 'ok' || health?.apiVersion !== 2 || health?.capabilities?.idempotentWrites !== true) {
        throw new ApiError('This server needs an update before it can safely save orders and payments. Deploy the current OrderLedger backend, then retry.', 503);
      }
      if (this.getBase() !== base || localStorage.getItem(TOKEN_KEY) !== token) throw new ApiError('Your session changed. Reload the workspace before saving.', 401);
      const result = await this.request<T>(endpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } });
      if (!result || typeof (result as { id?: unknown }).id !== 'string') throw new ApiError('The server did not confirm the saved record. Retry with the same details.', 0);
      return result;
    }, [previousScope]);
  }
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
  static async updateBusiness(body: BusinessPatch) {
    const updated = await this.write<Business>('/business', body, 'PATCH');
    if (!updated?.settings) throw new ApiError('The server did not return saved settings. Deploy the current OrderLedger backend, then reload and retry.', 503);
    return updated;
  }
  static async getConnections() {
    try { return providerSettings(await this.request<unknown>('/business/connections')); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) throw new ApiError('Provider settings are unavailable on this server. Deploy the current OrderLedger backend to enable Connections.', 503);
      throw error;
    }
  }
  static async updateConnections(body: Partial<Record<'primary' | 'fallback', Partial<Omit<ProviderConnection, 'hasApiKey'>> & { apiKey?: string }>>) { return providerSettings(await this.write<unknown>('/business/connections', body, 'PATCH')); }
  static getDashboard() { return this.request<DashboardSummary>('/dashboard/summary'); }
  static async getWhatsAppConnection() { return whatsappSettings(await this.request<unknown>('/whatsapp/connection')); }
  static async updateWhatsAppConnection(body: WhatsAppConnectionPatch) { return whatsappSettings(await this.write<unknown>('/whatsapp/connection',body,'PATCH')); }
  static testWhatsAppConnection() { return this.request<{ displayPhoneNumber: string }>('/whatsapp/connection/test', { method: 'POST', body: '{}', signal: AbortSignal.timeout(CONNECTION_TIMEOUT) }); }
  static testAiConnection() { return this.request<{ provider: string; model: string; wasFallback: boolean; warnings: string[] }>('/whatsapp/ai/test', { method: 'POST', body: '{}', signal: AbortSignal.timeout(CONNECTION_TIMEOUT) }); }
  static async getWhatsAppMessages(): Promise<WhatsAppMessage[]> {
    const messages = await this.request<unknown>('/whatsapp/messages');
    if (!Array.isArray(messages)) {
      throw new ApiError('WhatsApp inbox is unavailable because this server is running an older OrderLedger backend. Deploy the latest backend, then refresh the inbox.', 503);
    }
    return messages;
  }
  static getWhatsAppRevision() { return this.request<{ revision: string }>('/whatsapp/revision'); }
  static getLocalDemoStatus() { return this.request<{available:boolean;businessId:string;businessName:string;replies:'local'}>('/local-demo/status'); }
  static openLocalDemo() { return this.request<{token:string;user:User;business:Business}>('/local-demo/session',{method:'POST',headers:{'X-OrderLedger-Local-Demo':'1'},body:'{}'}); }
  static sendLocalDemoMessage(body:{customerId:string;text:string;image?:{data:string;mimeType:string}}) { return this.write('/local-demo/messages',body); }
  static reviewWhatsAppMessage(id: string, items: { productId: string; quantity: number }[]) { return this.write('/whatsapp/messages/'+id+'/review',{ items }); }
  static retryWhatsAppJob(id: string) { return this.write('/whatsapp/jobs/'+id+'/retry',{ acknowledgeDuplicateRisk: true }); }
  static getOrders(params?: { status?: string; customerId?: string }) { return this.listAll<Order>('/orders', params); }
  static getOrder(id: string) { return this.request<Order>('/orders/' + id); }
  static createOrder(body: OrderInput) { return this.writeOnce<Order>('/orders', body); }
  static async extractOrder(body: { text: string; image?: { data: string; mimeType: string } }): Promise<OrderImportResult> {
    try {
      const data = await this.request<OrderImportResult>('/orders/extract', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(CONNECTION_TIMEOUT) });
      if (!data || !Array.isArray(data.items) || !data.items.length || !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string') || data.items.some(item => !item || typeof item.productId !== 'string' || typeof item.inputProduct !== 'string' || typeof item.inputUnit !== 'string' || !Number.isFinite(item.inputQuantity) || (item.quantity !== null && (!Number.isFinite(item.quantity) || item.quantity <= 0)))) {
        throw new ApiError('The server returned an unreadable order draft. Your existing items have been kept. Try extracting again.', 502);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw new ApiError('Order import is not available on this server yet. Try again after the server update completes.', 503);
      throw error;
    }
  }
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
  static recordPayment(body: PaymentInput) { return this.writeOnce<Payment>('/payments', body); }
}
