import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, BarChart3, BookOpen, ChevronDown, CircleHelp, CreditCard, LayoutDashboard, LogOut, MoreHorizontal, Package, Plus, ReceiptText, Settings2, ShoppingBag, Users } from 'lucide-react';
import { Button, Modal } from '../ui';
import { useBusiness } from '../../features/settings/businessSettings';

interface AppShellProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenNewOrder: () => void;
  userName?: string;
  userRole?: string;
  onLogout: () => void;
  children: ReactNode;
}
export function AppShell({ currentTab, onSelectTab, onOpenNewOrder, userName = 'Owner', userRole = 'OWNER', onLogout, children }: AppShellProps) {
  const { business, settings } = useBusiness();
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const nav = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'products', label: settings.catalog.productLabel === 'Products' ? 'Catalog' : settings.catalog.productLabel, icon: Package },
    { id: 'customers', label: settings.catalog.customerLabel, icon: Users },
    { id: 'invoices', label: 'Invoices', icon: ReceiptText },
    ...(settings.modules.payments ? [{ id: 'payments', label: 'Payments', icon: CreditCard }] : []),
    ...(settings.modules.reports ? [{ id: 'reports', label: 'Reports', icon: BarChart3 }] : []),
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];
  const select = (id: string) => { setMoreOpen(false); onSelectTab(id); };
  const logo = <div className="brand-symbol">{business?.logo_url ? <img src={business.logo_url} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <BookOpen size={24} strokeWidth={1.8} aria-hidden="true" />}</div>;
  const navButtons = (mobile = false) => nav.map(({ id, label, icon: Icon }) =>
    <button key={id} type="button" className={'nav-item ' + (currentTab === id ? 'selected' : '')} aria-current={currentTab === id ? 'page' : undefined} onClick={() => select(id)}>
      <Icon size={20} aria-hidden="true" /><span>{label}</span>{mobile && <ArrowUpRight size={16} className="nav-arrow" aria-hidden="true" />}
    </button>
  );
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => select('dashboard')}>{logo}<span>{settings.branding.appName}<small>YOUR BUSINESS, TOGETHER</small></span></button>
      <div className="workspace-label"><span className="status-dot" /><span>{business?.name}</span></div>
      <p className="nav-caption">WORKSPACE</p>
      <nav aria-label="Main navigation">{navButtons()}</nav>
      <div className="sidebar-bottom">
        {userRole === 'OWNER' && <button className="customize-card" onClick={() => select('settings')}><Settings2 size={21} aria-hidden="true" /><strong>Make it yours</strong><p>A setup that fits your business.</p><span>Customize workspace <ArrowUpRight size={15} aria-hidden="true" /></span></button>}
        <div className="profile-row"><div className="avatar">{userName.slice(0, 1).toUpperCase()}</div><div className="profile-name"><strong>{userName}</strong><small>{userRole === 'OWNER' ? 'Business owner' : userRole === 'DELIVERY' ? 'Delivery team' : 'Team member'}</small></div><Button variant="ghost" className="icon-button" aria-label="Sign out" onClick={onLogout}><LogOut size={18} /></Button></div>
      </div>
    </aside>
    <div className="workspace-content">
      <header className="topbar">
        <div className="desktop-breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{nav.find(n => n.id === currentTab)?.label}</strong></div>
        <button className="mobile-brand" type="button" onClick={() => setMoreOpen(true)}>{logo}<span>{business?.name}</span><ChevronDown size={16} aria-hidden="true" /></button>
        <div className="topbar-actions"><Button variant="ghost" className="icon-button" aria-label="Workspace help" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></Button><Button size="sm" onClick={onOpenNewOrder}><Plus size={18} aria-hidden="true" />New order</Button></div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>{settings.branding.tagline}</span><span>{business?.currency || 'INR'} · {settings.branding.appName}</span></footer>
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {nav.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={id === currentTab ? 'page' : undefined} className={id === currentTab ? 'selected' : ''} onClick={() => select(id)}><span><Icon size={21} aria-hidden="true" /></span><small>{id === 'dashboard' ? 'Home' : label}</small></button>)}
      <button type="button" aria-expanded={moreOpen} className={nav.slice(4).some(n => n.id === currentTab) ? 'selected' : ''} onClick={() => setMoreOpen(true)}><span><MoreHorizontal size={23} aria-hidden="true" /></span><small>More</small></button>
    </nav>
    <Modal isOpen={moreOpen} title="Your workspace" onClose={() => setMoreOpen(false)}>
      <nav className="mobile-menu" aria-label="All pages">{navButtons(true)}</nav>
      <div className="profile-row"><div><strong>{userName}</strong><p className="muted">{business?.name}</p></div><Button variant="outline" onClick={onLogout}><LogOut size={16} aria-hidden="true" />Sign out</Button></div>
    </Modal>
    <Modal isOpen={helpOpen} title="A simple daily routine" onClose={() => setHelpOpen(false)}>
      <ol className="help-steps"><li>Add your products and prices in Catalog.</li><li>Add customers and their payment terms.</li><li>Create an order, then mark it packed and delivered.</li><li>An invoice is created at your chosen billing stage.</li><li>Record money received. Open a customer statement to see the balance.</li></ol>
      <p className="muted">Business owners can change branding, catalog defaults and billing in Settings. WhatsApp ordering will be available after its integration.</p>
      <div className="form-actions"><Button onClick={() => setHelpOpen(false)}>Got it</Button></div>
    </Modal>
  </div>;
}
