import React from 'react';
import { Card, Badge, Button } from '../../components/ui';
import { Order, OrderStatus } from '../../types';
import { formatCurrency, formatDateTime, formatRelativeTime } from '../../utils/formatters';
import {
  Clock,
  PackageCheck,
  Truck,
  CheckCircle2,
  Receipt,
  ArrowLeft,
  Calendar,
  Phone,
  User,
  ShieldCheck
} from 'lucide-react';

interface OrderDetailModalProps {
  order: Order | null;
  onClose: () => void;
  onUpdateStatus: (orderId: string, nextStatus: OrderStatus) => void;
}

export function OrderDetailModal({
  order,
  onClose,
  onUpdateStatus
}: OrderDetailModalProps) {
  if (!order) return null;

  // Timeline events computation
  const stages = [
    {
      label: 'Created',
      time: order.created_at,
      completed: true,
      icon: Clock,
    },
    {
      label: 'Confirmed',
      time: order.confirmed_at || order.created_at,
      completed: !!order.confirmed_at || true,
      icon: ShieldCheck,
    },
    {
      label: 'Packed',
      time: order.packed_at,
      completed: !!order.packed_at || order.status === 'Packed' || order.status === 'Delivered',
      icon: PackageCheck,
    },
    {
      label: 'Delivered',
      time: order.delivered_at,
      completed: !!order.delivered_at || order.status === 'Delivered',
      icon: Truck,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-100 space-y-6">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 -ml-2 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-slate-900">Order #{order.order_no}</h3>
                <Badge variant={order.status === 'Delivered' ? 'success' : order.status === 'Packed' ? 'info' : 'warning'}>
                  {order.status}
                </Badge>
              </div>
              <p className="text-xs text-slate-400">Source: {order.source}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400"
          >
            ✕
          </button>
        </div>

        {/* Customer Information Card */}
        <div className="p-4 bg-slate-50/80 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-sm">
              <User className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">{order.customer_name}</p>
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <Phone className="w-3 h-3" /> {order.customer_phone || 'No phone'}
              </p>
            </div>
          </div>

          {order.invoice_no && (
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Invoice</p>
              <p className="text-xs font-bold text-brand-600">INV-{String(order.invoice_no).padStart(4, '0')}</p>
            </div>
          )}
        </div>

        {/* Operational Timeline (Cashew Progression Stepper) */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Fulfillment Timeline</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stages.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <div
                  key={stage.label}
                  className={`p-3 rounded-2xl border text-center transition-all ${
                    stage.completed
                      ? 'bg-emerald-50/50 border-emerald-200/80 text-emerald-900'
                      : 'bg-slate-50/50 border-slate-100 text-slate-400'
                  }`}
                >
                  <Icon className={`w-4 h-4 mx-auto mb-1.5 ${stage.completed ? 'text-emerald-600' : 'text-slate-300'}`} />
                  <p className="text-xs font-bold">{stage.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                    {stage.time ? formatRelativeTime(stage.time) : 'Pending'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Frozen Price Line Items Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Order Items (Frozen Snapshot)</h4>
            <span className="text-[10px] text-slate-400">Price locked at time of order</span>
          </div>

          <div className="border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-100">
            {order.items && order.items.length > 0 ? (
              order.items.map((item) => (
                <div key={item.id} className="p-3.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800">{item.product_name}</span>
                    <span className="text-slate-400 block text-[11px]">
                      {item.quantity} {item.unit} @ {formatCurrency(item.unit_price_at_order)}/{item.unit}
                    </span>
                  </div>
                  <span className="font-extrabold text-slate-900">
                    {formatCurrency(item.total_price)}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">
                Items recorded under order total.
              </div>
            )}
          </div>

          <div className="mt-3 p-4 bg-slate-900 text-white rounded-2xl flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Final Order Total</span>
            <span className="text-lg font-black tracking-tight">{formatCurrency(order.total_amount)}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>

          {order.status === 'Received' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onUpdateStatus(order.id, 'Packed')}
              className="bg-sky-600 hover:bg-sky-700 text-xs"
            >
              Advance to Packed
            </Button>
          )}

          {order.status === 'Packed' && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onUpdateStatus(order.id, 'Delivered')}
              className="bg-emerald-600 hover:bg-emerald-700 text-xs"
            >
              Advance to Delivered (Triggers Invoice)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
