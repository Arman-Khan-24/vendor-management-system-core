import React, { useState, useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { DashboardView } from './features/dashboard/DashboardView';
import { OrdersView } from './features/orders/OrdersView';
import { OrderDetailModal } from './features/orders/OrderDetailModal';
import { NewOrderModal } from './features/orders/NewOrderModal';
import { CustomersView } from './features/customers/CustomersView';
import { StatementModal } from './features/customers/StatementModal';
import { ProductsView } from './features/products/ProductsView';
import { PaymentsView } from './features/payments/PaymentsView';
import { ReportsView } from './features/reports/ReportsView';
import { AuthView } from './features/auth/AuthView';
import { ApiClient } from './api/client';
import { Order, Customer, Product, Payment, DashboardSummary, OrderStatus } from './types';

export function App() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentBusiness, setCurrentBusiness] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<string>('dashboard');

  // Application Data
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // Modals
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);

  // Check initial login state
  useEffect(() => {
    async function checkAuth() {
      try {
        const data = await ApiClient.getMe();
        setCurrentUser(data.user);
        setCurrentBusiness(data.business);
      } catch (e) {
        ApiClient.clearToken();
      } finally {
        setLoadingAuth(false);
      }
    }
    checkAuth();
  }, []);

  // Fetch tenant operational data
  const refreshData = async () => {
    if (!currentUser) return;
    try {
      const [sum, ords, custs, prods, pays] = await Promise.all([
        ApiClient.getDashboard().catch(() => null),
        ApiClient.getOrders().catch(() => []),
        ApiClient.getCustomers().catch(() => []),
        ApiClient.getProducts().catch(() => []),
        ApiClient.getPayments().catch(() => [])
      ]);
      if (sum) setDashboardSummary(sum);
      setOrders(ords);
      setCustomers(custs);
      setProducts(prods);
      setPayments(pays);
    } catch (err) {
      console.error('Failed to load tenant data:', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      refreshData();
    }
  }, [currentUser]);

  // Order state update handler
  const handleUpdateOrderStatus = async (orderId: string, nextStatus: OrderStatus) => {
    try {
      const updated = await ApiClient.updateOrderStatus(orderId, nextStatus);
      setOrders(orders.map(o => (o.id === orderId ? updated : o)));
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder(updated);
      }
      refreshData();
    } catch (err: any) {
      alert(`Status update failed: ${err.message}`);
    }
  };

  // Create order handler
  const handleCreateOrder = async (data: { customerId: string; notes?: string; items: any[] }) => {
    try {
      await ApiClient.createOrder(data);
      refreshData();
    } catch (err: any) {
      alert(`Order creation failed: ${err.message}`);
    }
  };

  // Customer statement viewer
  const handleViewStatement = async (customer: Customer) => {
    try {
      const statement = await ApiClient.getCustomerStatement(customer.id);
      setSelectedStatement(statement);
    } catch (err: any) {
      alert(`Failed to load statement: ${err.message}`);
    }
  };

  // Record payment handler
  const handleRecordPayment = async (data: any) => {
    try {
      await ApiClient.recordPayment(data);
      refreshData();
    } catch (err: any) {
      alert(`Payment recording failed: ${err.message}`);
    }
  };

  // Create customer
  const handleCreateCustomer = async (data: any) => {
    try {
      await ApiClient.createCustomer(data);
      refreshData();
    } catch (err: any) {
      alert(`Failed to create customer: ${err.message}`);
    }
  };

  // Create product
  const handleCreateProduct = async (data: any) => {
    try {
      await ApiClient.createProduct(data);
      refreshData();
    } catch (err: any) {
      alert(`Failed to create product: ${err.message}`);
    }
  };

  // Logout
  const handleLogout = () => {
    ApiClient.clearToken();
    setCurrentUser(null);
    setCurrentBusiness(null);
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthView
        onSuccess={(user, business) => {
          setCurrentUser(user);
          setCurrentBusiness(business);
        }}
      />
    );
  }

  return (
    <AppShell
      currentTab={currentTab}
      onSelectTab={setCurrentTab}
      onOpenNewOrder={() => setShowNewOrderModal(true)}
      businessName={currentBusiness?.name}
      userName={currentUser?.name}
      onLogout={handleLogout}
    >
      {currentTab === 'dashboard' && (
        <DashboardView
          summary={dashboardSummary}
          onNavigateTab={setCurrentTab}
          onOpenNewOrder={() => setShowNewOrderModal(true)}
          onOpenRecordPayment={() => setShowRecordPaymentModal(true)}
        />
      )}

      {currentTab === 'orders' && (
        <OrdersView
          orders={orders}
          onSelectOrder={async (ord) => {
            try {
              const fullOrder = await ApiClient.getOrder(ord.id);
              setSelectedOrder(fullOrder);
            } catch {
              setSelectedOrder(ord);
            }
          }}
          onUpdateStatus={handleUpdateOrderStatus}
          onOpenNewOrder={() => setShowNewOrderModal(true)}
        />
      )}


      {currentTab === 'customers' && (
        <CustomersView
          customers={customers}
          onSelectCustomer={handleViewStatement}
          onCreateCustomer={handleCreateCustomer}
        />
      )}

      {currentTab === 'products' && (
        <ProductsView
          products={products}
          onCreateProduct={handleCreateProduct}
        />
      )}

      {currentTab === 'payments' && (
        <PaymentsView
          payments={payments}
          customers={customers}
          onRecordPayment={handleRecordPayment}
          showRecordModal={showRecordPaymentModal}
          setShowRecordModal={setShowRecordPaymentModal}
        />
      )}

      {currentTab === 'invoices' && (
        <div className="space-y-4">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Invoices</h2>
          <p className="text-xs text-slate-500">
            Tenant-scoped sequential invoice repository with payment allocation reconciliation
          </p>
          <div className="border border-slate-100 bg-white rounded-3xl p-5 shadow-sm divide-y divide-slate-100">
            {orders.filter(o => o.invoice_no).length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No invoices generated yet. Invoices are triggered on order fulfillment.</p>
            ) : (
              orders.filter(o => o.invoice_no).map(o => (
                <div key={o.id} className="py-3.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900 block">INV-{String(o.invoice_no).padStart(4, '0')}</span>
                    <span className="text-slate-400 text-[11px]">{o.customer_name} · Order #{o.order_no}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-slate-900 block">{o.total_amount ? `₹${o.total_amount}` : '—'}</span>
                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      {o.invoice_status || 'Pending'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {currentTab === 'reports' && (
        <ReportsView
          onOpenStatement={async (customerId) => {
            try {
              const statement = await ApiClient.getCustomerStatement(customerId);
              setSelectedStatement(statement);
            } catch (err: any) {
              alert(`Failed to load statement: ${err.message}`);
            }
          }}
        />
      )}

      {currentTab === 'settings' && (
        <div className="max-w-xl space-y-5">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Business Settings</h2>
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4 text-xs">
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">Business Name</span>
              <span className="font-bold text-slate-900 text-sm mt-0.5 block">{currentBusiness?.name}</span>
            </div>
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">Tenant Slug (Scoping ID)</span>
              <span className="font-mono text-slate-700 bg-slate-100 px-2 py-1 rounded-lg mt-0.5 inline-block">
                {currentBusiness?.slug}
              </span>
            </div>
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">Invoice Auto-Generation Trigger</span>
              <span className="font-semibold text-slate-700 mt-0.5 block">
                Triggered on status: <strong className="text-brand-600">{currentBusiness?.invoice_trigger || 'Delivered'}</strong>
              </span>
            </div>
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">WhatsApp Text AI Ingestion Status</span>
              <div className="mt-1 p-3 bg-emerald-50/50 rounded-2xl border border-emerald-100 flex items-center justify-between">
                <div>
                  <span className="font-bold text-emerald-800 text-xs block">Active & Listening</span>
                  <span className="text-[11px] text-emerald-600 font-mono">
                    /webhooks/whatsapp/{currentBusiness?.id}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                  Gemini + Groq Fallback
                </span>
              </div>
            </div>
            <div>
              <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">Authenticated User Role</span>
              <span className="font-semibold text-slate-700 mt-0.5 block">{currentUser?.role} ({currentUser?.email})</span>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdateStatus={handleUpdateOrderStatus}
      />

      <NewOrderModal
        isOpen={showNewOrderModal}
        onClose={() => setShowNewOrderModal(false)}
        customers={customers}
        products={products}
        onSubmit={handleCreateOrder}
      />

      <StatementModal
        statementData={selectedStatement}
        onClose={() => setSelectedStatement(null)}
        onFilterChange={async (startDate, endDate) => {
          if (!selectedStatement?.customer?.id) return;
          const updated = await ApiClient.getCustomerStatement(selectedStatement.customer.id, {
            startDate,
            endDate
          });
          setSelectedStatement(updated);
        }}
      />
    </AppShell>
  );
}
export default App;
