import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, RefreshCw, X } from 'lucide-react';
import { ApiClient, ApiError } from './api/client';
import { AppShell } from './components/layout/AppShell';
import { Button, EmptyState, ErrorNotice, LoadingState, Modal } from './components/ui';
import { AuthView } from './features/auth/AuthView';
import { CustomersView } from './features/customers/CustomersView';
import { StatementModal } from './features/customers/StatementModal';
import { DashboardView } from './features/dashboard/DashboardView';
import { InvoicesView, InvoiceModal } from './features/invoices/InvoicesView';
import { NewOrderModal } from './features/orders/NewOrderModal';
import { OrderDetailModal } from './features/orders/OrderDetailModal';
import { OrdersView } from './features/orders/OrdersView';
import { PaymentsView, RecordPaymentModal } from './features/payments/PaymentsView';
import { ProductsView } from './features/products/ProductsView';
import { ReportsView } from './features/reports/ReportsView';
import { BusinessProvider, getSettings } from './features/settings/businessSettings';
import { ServerConnection } from './features/settings/ConnectionSettings';
import { SettingsView } from './features/settings/SettingsView';
import type { Business, BusinessUpdate, Customer, CustomerInput, DashboardSummary, Invoice, Order, OrderInput, OrderStatus, Payment, PaymentInput, Product, ProductInput, User } from './types';
import { errorMessage } from './utils/formatters';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [settingsSection, setSettingsSection] = useState('business');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newOrder, setNewOrder] = useState(false);
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [statement, setStatement] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);
  const session = useRef(0);
  const load = useRef(0);
  const detail = useRef(0);
  const settings = getSettings(business);

  const logout = useCallback(() => {
    session.current++; load.current++; detail.current++;
    ApiClient.clearToken();
    setUser(null); setBusiness(null); setAuthError(null); setAuthLoading(false);
    setOrders([]); setCustomers([]); setProducts([]); setPayments([]); setInvoices([]); setSummary(null);
    setNewOrder(false); setPaymentFor(null); setOrder(null); setInvoiceId(null); setInvoice(null); setStatementId(null); setStatement(null);
    setSettingsDirty(false); setPendingNavigation(null); setDataError(null); setLoadingData(false); setTab('dashboard'); setToast(null);
  }, []);
  const checkAuth = useCallback(async () => {
    const version = ++session.current;
    setAuthError(null);
    if (!ApiClient.hasToken()) { setAuthLoading(false); return; }
    setAuthLoading(true);
    try {
      const result = await ApiClient.getMe();
      if (session.current === version) { setUser(result.user); setBusiness(result.business); }
    } catch (e) {
      if (session.current !== version) return;
      if (e instanceof ApiError && e.status === 401) ApiClient.clearToken();
      else setAuthError(errorMessage(e));
    } finally { if (session.current === version) setAuthLoading(false); }
  }, []);
  useEffect(() => {
    void checkAuth();
    window.addEventListener('orderledger:connection', logout);
    window.addEventListener('orderledger:unauthorized', logout);
    return () => {
      session.current++;
      window.removeEventListener('orderledger:connection', logout);
      window.removeEventListener('orderledger:unauthorized', logout);
    };
  }, [checkAuth, logout]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  const refresh = useCallback(async () => {
    if (!user) return;
    const version = ++load.current;
    setLoadingData(true);
    const results = await Promise.allSettled([ApiClient.getDashboard(), ApiClient.getOrders(), ApiClient.getCustomers(), ApiClient.getProducts(), ApiClient.getPayments(), ApiClient.getInvoices()]);
    if (load.current !== version) return;
    const [dash, ord, cust, prod, pay, inv] = results;
    if (dash.status === 'fulfilled') setSummary(dash.value);
    if (ord.status === 'fulfilled') setOrders(ord.value);
    if (cust.status === 'fulfilled') setCustomers(cust.value);
    if (prod.status === 'fulfilled') setProducts(prod.value);
    if (pay.status === 'fulfilled') setPayments(pay.value);
    if (inv.status === 'fulfilled') setInvoices(inv.value);
    const labels = ['overview', 'orders', 'customers', 'catalog', 'payments', 'invoices'];
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [labels[i] + ': ' + errorMessage(r.reason)] : []);
    setDataError(failed.length ? 'Could not refresh ' + failed.join(' · ') : null);
    setLoadingData(false);
  }, [user]);
  useEffect(() => { if (user) void refresh(); }, [user, refresh]);
  useEffect(() => {
    if ((tab === 'payments' && !settings.modules.payments) || (tab === 'reports' && !settings.modules.reports)) setTab('dashboard');
  }, [settings.modules.payments, settings.modules.reports, tab]);

  const navigate = (next: string) => {
    if (settingsDirty && next !== 'settings') { setPendingNavigation(next); return; }
    setTab(next);
    if (next !== 'settings') setSettingsSection('business');
    window.scrollTo(0, 0);
  };
  const requestLogout = () => { if (settingsDirty) setPendingNavigation('logout'); else logout(); };
  const saveMutation = async (action: () => Promise<unknown>, message: string) => {
    await action();
    setToast(message);
    void refresh();
  };
  const openOrder = async (selected: Order) => {
    const version = ++detail.current;
    setOrder(selected); setInvoiceId(null); setStatementId(null); setOrderError(null); setOrderLoading(true);
    try { const complete = await ApiClient.getOrder(selected.id); if (detail.current === version) setOrder(complete); }
    catch (e) { if (detail.current === version) setOrderError(errorMessage(e)); }
    finally { if (detail.current === version) setOrderLoading(false); }
  };
  const updateOrder = async (id: string, status: OrderStatus) => {
    const updated = await ApiClient.updateOrderStatus(id, status);
    setOrder(updated); setToast('Order marked ' + status.toLowerCase() + '.');
    void refresh();
  };
  const openInvoice = async (id: string) => {
    const version = ++detail.current;
    setOrder(null); setStatementId(null); setInvoice(null); setInvoiceId(id); setInvoiceError(null);
    try { const complete = await ApiClient.getInvoice(id); if (detail.current === version) setInvoice(complete); }
    catch (e) { if (detail.current === version) setInvoiceError(errorMessage(e)); }
  };
  const openStatement = async (id: string) => {
    const version = ++detail.current;
    setOrder(null); setInvoiceId(null); setStatement(null); setStatementId(id); setStatementError(null); setStatementLoading(true);
    try { const complete = await ApiClient.getCustomerStatement(id); if (detail.current === version) setStatement(complete); }
    catch (e) { if (detail.current === version) setStatementError(errorMessage(e)); }
    finally { if (detail.current === version) setStatementLoading(false); }
  };
  const openPayment = (customerId = '') => { detail.current++; setInvoiceId(null); setStatementId(null); setOrder(null); setPaymentFor(customerId); };
  const saveSettings = async (data: BusinessUpdate) => {
    const updated = await ApiClient.updateBusiness(data);
    setBusiness(updated); setToast('Business settings saved.'); setSettingsDirty(false);
    void refresh();
  };
  if (authLoading) return <BusinessProvider business={null}><LoadingState label="Opening your workspace…" /></BusinessProvider>;
  if (!user || !business) return <BusinessProvider business={null}>
    {authError ? <div className="auth-content" style={{ minHeight: '100dvh' }}><div className="auth-form stack"><h2>Let’s reconnect.</h2><ErrorNotice message={authError} /><Button onClick={() => void checkAuth()}><RefreshCw size={18} aria-hidden="true" />Try again</Button><Button variant="outline" onClick={() => setConnectionOpen(true)}><Link2 size={18} aria-hidden="true" />Check server connection</Button><Button variant="ghost" onClick={logout}>Back to sign in</Button></div></div> :
      <AuthView onSuccess={(account, tenant) => { session.current++; setUser(account); setBusiness(tenant); setTab('dashboard'); }} />}
    <Modal isOpen={connectionOpen} onClose={() => setConnectionOpen(false)} title="Server connection"><ServerConnection /></Modal>
  </BusinessProvider>;
  return <BusinessProvider business={business}>
    <AppShell currentTab={tab} onSelectTab={navigate} onOpenNewOrder={() => setNewOrder(true)} userName={user.name} userRole={user.role} onLogout={requestLogout}>
      <div className="stack">
        {dataError && <ErrorNotice message={dataError} retry={() => void refresh()} />}
        {loadingData && !summary && tab !== 'settings' ? <LoadingState /> : <>
          {tab === 'dashboard' && (summary ? <DashboardView summary={summary} customers={customers} products={products} orders={orders} userName={user.name} onNavigateTab={navigate} onOpenNewOrder={() => setNewOrder(true)} onOpenRecordPayment={() => openPayment()} onSelectOrder={openOrder} onStatement={openStatement} /> : <EmptyState title="Your overview could not load" description="Try refreshing once the server is available." action={<Button onClick={() => void refresh()}>Refresh overview</Button>} />)}
          {tab === 'products' && <ProductsView products={products} onCreateProduct={(data: ProductInput) => saveMutation(() => ApiClient.createProduct(data), 'Product added.')} onUpdateProduct={(id, data) => saveMutation(() => ApiClient.updateProduct(id, data), data.active === false ? 'Product archived.' : data.active === true ? 'Product restored.' : 'Product updated.')} onCustomize={() => { setSettingsSection('catalog'); navigate('settings'); }} />}
          {tab === 'customers' && <CustomersView customers={customers} onSelectCustomer={c => void openStatement(c.id)} onCreateCustomer={(data: CustomerInput) => saveMutation(() => ApiClient.createCustomer(data), 'Customer added.')} onUpdateCustomer={(id, data) => saveMutation(() => ApiClient.updateCustomer(id, data), data.active === false ? 'Customer archived.' : data.active === true ? 'Customer restored.' : 'Customer updated.')} onRecordPayment={openPayment} />}
          {tab === 'orders' && <OrdersView orders={orders} onSelectOrder={openOrder} onOpenNewOrder={() => setNewOrder(true)} />}
          {tab === 'invoices' && <InvoicesView invoices={invoices} onSelect={i => void openInvoice(i.id)} />}
          {tab === 'payments' && settings.modules.payments && <PaymentsView payments={payments} onOpenRecord={() => openPayment()} onStatement={openStatement} />}
          {tab === 'reports' && settings.modules.reports && <ReportsView onOpenStatement={openStatement} />}
          {tab === 'settings' && <SettingsView business={business} user={user} onSave={saveSettings} onDirtyChange={setSettingsDirty} initialSection={settingsSection} />}
        </>}
      </div>
    </AppShell>
    {newOrder && <NewOrderModal isOpen onClose={() => setNewOrder(false)} customers={customers} products={products} onSubmit={(data: OrderInput) => saveMutation(() => ApiClient.createOrder(data), 'Order created.')} onSetup={navigate} />}
    {paymentFor !== null && <RecordPaymentModal customers={customers} initialCustomerId={paymentFor} onClose={() => setPaymentFor(null)} onSubmit={(data: PaymentInput) => saveMutation(() => ApiClient.recordPayment(data), 'Payment recorded.')} onSetup={() => { setPaymentFor(null); navigate('customers'); }} />}
    {order && <OrderDetailModal order={order} loading={orderLoading} loadError={orderError} onClose={() => { detail.current++; setOrder(null); }} onUpdateStatus={updateOrder} onInvoice={openInvoice} />}
    {invoiceId && (invoice ? <InvoiceModal invoice={invoice} onClose={() => { detail.current++; setInvoiceId(null); }} onPayment={openPayment} onStatement={openStatement} /> : <Modal isOpen title="Invoice" onClose={() => { detail.current++; setInvoiceId(null); }}>{invoiceError ? <ErrorNotice message={invoiceError} retry={() => void openInvoice(invoiceId)} /> : <LoadingState label="Loading invoice…" />}</Modal>)}
    {statementId && <StatementModal key={statementId} statementData={statement} loading={statementLoading} loadError={statementError} onClose={() => { detail.current++; setStatementId(null); }} onFilterChange={async (startDate, endDate) => { const result = await ApiClient.getCustomerStatement(statementId, { startDate, endDate }); setStatement(result); }} />}
    <Modal isOpen={pendingNavigation !== null} title="Unsaved settings" onClose={() => setPendingNavigation(null)}><div className="stack"><p>Your business settings have unsaved changes. Keep editing or leave and discard them.</p><div className="form-actions"><Button variant="secondary" onClick={() => setPendingNavigation(null)}>Keep editing</Button><Button variant="danger" onClick={() => { const next = pendingNavigation; setPendingNavigation(null); setSettingsDirty(false); if (next === 'logout') logout(); else if (next) setTab(next); }}>Discard & leave</Button></div></div></Modal>
    {toast && <div className="toast" role="status"><CheckCircle2 size={19} aria-hidden="true" /><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </BusinessProvider>;
}
export default App;
