import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Receipt,
  CreditCard,
  BarChart3,
  Settings,
  LogOut,
  Plus
} from 'lucide-react';

interface AppShellProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenNewOrder: () => void;
  businessName?: string;
  userName?: string;
  onLogout: () => void;
  children: React.ReactNode;
}

export function AppShell({
  currentTab,
  onSelectTab,
  onOpenNewOrder,
  businessName = 'My Business',
  userName = 'Vendor',
  onLogout,
  children
}: AppShellProps) {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: ShoppingCart },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'products', label: 'Catalog', icon: Package },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'invoices', label: 'Invoices', icon: Receipt },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row pb-20 md:pb-0">
      {/* Desktop Sidebar Rail */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200/80 bg-white min-h-screen p-5 select-none sticky top-0 h-screen">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-3 py-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-brand-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20 font-extrabold text-lg tracking-wider">
            OL
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold text-slate-900 text-base leading-tight truncate">OrderLedger</h1>
            <p className="text-xs text-slate-400 font-medium truncate">{businessName}</p>
          </div>
        </div>

        {/* Primary Action Button */}
        <button
          onClick={onOpenNewOrder}
          className="w-full mb-6 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-md shadow-brand-500/20 active:scale-[0.98] transition-all"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New Order</span>
        </button>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-sm font-semibold transition-all ${
                  active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'text-brand-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Footer Profile */}
        <div className="pt-4 mt-auto border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs">
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <div className="truncate">
              <p className="text-xs font-bold text-slate-800 truncate">{userName}</p>
              <p className="text-[10px] text-slate-400">Authenticated</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto max-h-screen">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-5 py-4 bg-white border-b border-slate-200/60 sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              OL
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-sm leading-tight">{businessName}</h2>
              <p className="text-[10px] text-slate-400">OrderLedger</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenNewOrder}
              className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center text-white shadow-sm active:scale-95"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button
              onClick={onLogout}
              className="p-1.5 text-slate-400 hover:text-rose-500"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Dynamic View Body */}
        <div className="p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar (Cashew-Style Thumb-Friendly) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200/80 px-2 py-2 flex justify-around items-center z-40 shadow-lg">
        {[
          { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
          { id: 'orders', label: 'Orders', icon: ShoppingCart },
          { id: 'customers', label: 'Clients', icon: Users },
          { id: 'payments', label: 'Payments', icon: CreditCard },
          { id: 'settings', label: 'More', icon: Settings },
        ].map((item) => {
          const Icon = item.icon;
          const active = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center w-14 py-1 rounded-2xl transition-all ${
                active ? 'text-brand-600 font-bold scale-105' : 'text-slate-400 hover:text-slate-600 font-medium'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : 'stroke-2'}`} />
              <span className="text-[10px] mt-0.5 tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
