import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Business, BusinessSettings } from '../../types';
import { formatCurrency } from '../../utils/formatters';

export const defaultSettings: BusinessSettings = {
  branding: { appName: 'OrderLedger', tagline: 'A little more order, every day.', accent: 'sage', theme: 'light' },
  profile: { address: '', email: '', taxId: '' },
  catalog: { productLabel: 'Products', customerLabel: 'Customers', defaultUnit: 'piece', units: ['piece', 'kg', 'gram', 'litre', 'dozen', 'box', 'packet', 'bag'], categories: [] },
  billing: { invoicePrefix: 'INV', defaultCreditTermsDays: 7, paymentMethods: ['cash', 'upi', 'bank_transfer', 'cheque'], taxRate: 0, footer: 'Thank you for your business.' },
  modules: { reports: true, payments: true },
};

export function getSettings(business?: Business | null): BusinessSettings {
  const stored = business?.settings;
  return {
    branding: { ...defaultSettings.branding, ...stored?.branding },
    profile: { ...defaultSettings.profile, ...stored?.profile },
    catalog: { ...defaultSettings.catalog, ...stored?.catalog },
    billing: { ...defaultSettings.billing, ...stored?.billing },
    modules: { ...defaultSettings.modules, ...stored?.modules },
  };
}

export const presets = [
  { id: 'fruits_veg', name: 'Fresh produce', description: 'Weight-based orders, fruits and vegetables.', unit: 'kg', units: ['kg', 'gram', 'box', 'piece', 'dozen'], categories: ['Vegetables', 'Fruits', 'Herbs'], credit: 7 },
  { id: 'grocery', name: 'Grocery & staples', description: 'Packaged goods and everyday essentials.', unit: 'packet', units: ['packet', 'kg', 'bag', 'box', 'litre', 'piece'], categories: ['Staples', 'Spices', 'Packaged food', 'Household'], credit: 14 },
  { id: 'dairy', name: 'Dairy & eggs', description: 'Milk, fresh dairy and regular deliveries.', unit: 'litre', units: ['litre', 'kg', 'packet', 'tray', 'dozen', 'piece'], categories: ['Milk', 'Dairy', 'Eggs'], credit: 7 },
  { id: 'custom', name: 'Your own setup', description: 'Start with flexible products and units.', unit: 'piece', units: ['piece', 'kg', 'litre', 'box', 'packet'], categories: [], credit: 7 },
];

const BusinessContext = createContext<{ business: Business | null; settings: BusinessSettings; money: (amount: number | string | null | undefined) => string }>({
  business: null, settings: defaultSettings, money: (amount) => formatCurrency(Number(amount)),
});

export function BusinessProvider({ business, children }: { business: Business | null; children: ReactNode }) {
  const settings = getSettings(business);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = settings.branding.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.branding.theme;
      document.documentElement.dataset.accent = settings.branding.accent;
    };
    apply();
    media.addEventListener('change', apply);
    document.title = business ? business.name + ' · ' + settings.branding.appName : 'OrderLedger';
    return () => media.removeEventListener('change', apply);
  }, [settings.branding.theme, settings.branding.accent, settings.branding.appName, business?.name]);
  return <BusinessContext.Provider value={{ business, settings, money: (amount) => formatCurrency(Number(amount), business?.currency || 'INR') }}>{children}</BusinessContext.Provider>;
}
export const useBusiness = () => useContext(BusinessContext);
