import React, { useState } from 'react';
import { Button, Input } from '../../components/ui';
import { ApiClient } from '../../api/client';

interface AuthModalProps {
  onSuccess: (user: any, business: any) => void;
}

export function AuthView({ onSuccess }: AuthModalProps) {
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('sunil@greenfield.app');
  const [password, setPassword] = useState('password123');

  const [businessName, setBusinessName] = useState('Fresh Green Wholesale');
  const [businessSlug, setBusinessSlug] = useState('fresh-green');
  const [categoryTemplate, setCategoryTemplate] = useState('fruits_veg');
  const [ownerName, setOwnerName] = useState('Aakash Patel');
  const [phone, setPhone] = useState('9876543210');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isRegister) {
        const res = await ApiClient.register({
          businessName,
          businessSlug,
          categoryTemplate,
          phone,
          ownerName,
          email,
          password
        });
        ApiClient.setToken(res.token);
        onSuccess(res.user, res.business);
      } else {
        const res = await ApiClient.login({ email, password });
        ApiClient.setToken(res.token);
        onSuccess(res.user, res.business);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-slate-100 space-y-6">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 text-white flex items-center justify-center mx-auto mb-3 text-lg font-black shadow-md shadow-brand-500/20">
            OL
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">OrderLedger</h2>
          <p className="text-xs text-slate-500 mt-1">Multi-tenant B2B vendor management SaaS</p>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <>
              <Input
                label="Business Name"
                value={businessName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setBusinessName(e.target.value);
                  setBusinessSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'));
                }}
                required
              />
              <Input
                label="Business Slug (Unique Tenant ID)"
                value={businessSlug}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusinessSlug(e.target.value)}
                required
              />
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  Category Template (Catalog Seeding)
                </label>
                <select
                  value={categoryTemplate}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategoryTemplate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold"
                >
                  <option value="fruits_veg">Fruits & Vegetables (Fresh Produce)</option>
                  <option value="grocery">Grocery & Staples (Rice, Dal, Oil)</option>
                  <option value="dairy">Dairy & Eggs (Milk, Paneer, Butter)</option>
                  <option value="custom">General Wholesale / Custom</option>
                </select>
              </div>
              <Input
                label="Owner Full Name"
                value={ownerName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOwnerName(e.target.value)}
                required
              />
              <Input
                label="Business Phone"
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                required
              />
            </>
          )}

          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading ? 'Processing...' : isRegister ? 'Create Business & Onboard' : 'Sign In to Ledger'}
          </Button>
        </form>

        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register new business"}
          </button>
        </div>
      </div>
    </div>
  );
}
