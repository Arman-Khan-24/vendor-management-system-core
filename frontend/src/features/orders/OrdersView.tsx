import React, { useState } from 'react';
import { Card, Badge, Button } from '../../components/ui';
import { Order, OrderStatus } from '../../types';
import { formatCurrency, formatDateTime, formatRelativeTime } from '../../utils/formatters';
import {
  Clock,
  Package,
  Truck,
  ArrowRight,
  Receipt,
  Eye,
  CheckCircle2,
  Calendar,
  Phone
} from 'lucide-react';

interface OrdersViewProps {
  orders: Order[];
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, nextStatus: OrderStatus) => void;
  onOpenNewOrder: () => void;
}

export function OrdersView({
  orders,
  onSelectOrder,
  onUpdateStatus,
  onOpenNewOrder
}: OrdersViewProps) {
  const [selectedStatusTab, setSelectedStatusTab] = useState<string>('ALL');

  const filteredOrders = orders.filter((o) => {
    if (selectedStatusTab === 'ALL') return true;
    return o.status === selectedStatusTab;
  });

  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case 'Received':
        return <Badge variant="warning">Received</Badge>;
      case 'Packed':
        return <Badge variant="info">Packed</Badge>;
      case 'Delivered':
        return <Badge variant="success">Delivered</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Orders</h2>
          <p className="text-xs text-slate-500 mt-0.5">Track and update customer fulfillment statuses</p>
        </div>

        <Button variant="primary" size="sm" onClick={onOpenNewOrder}>
          + New Order
        </Button>
      </div>

      {/* Cashew-Style Pill Status Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {['ALL', 'Received', 'Packed', 'Delivered'].map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedStatusTab(tab)}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all whitespace-nowrap ${
              selectedStatusTab === tab
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50'
            }`}
          >
            {tab === 'ALL' ? 'All Orders' : tab}
          </button>
        ))}
      </div>

      {/* Orders List / Cards */}
      {filteredOrders.length === 0 ? (
        <Card className="text-center py-12">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-slate-700">No orders found</h4>
          <p className="text-xs text-slate-400 mt-1">There are no orders matching the selected status.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <Card
              key={order.id}
              className="p-4 hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              {/* Left Details */}
              <div
                className="flex items-start gap-4 cursor-pointer flex-1"
                onClick={() => onSelectOrder(order)}
              >
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex flex-col items-center justify-center text-slate-700 font-extrabold text-sm shrink-0">
                  <span className="text-[10px] text-slate-400 font-semibold leading-none">#</span>
                  {order.order_no}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900 truncate">{order.customer_name}</h4>
                    {getStatusBadge(order.status)}
                    {order.source === 'whatsapp_text' && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        WhatsApp
                      </span>
                    )}
                    {order.invoice_no && (
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        INV-{String(order.invoice_no).padStart(4, '0')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-1.5 flex-wrap">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {formatDateTime(order.created_at)}
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {formatRelativeTime(order.created_at)}
                    </span>
                    {order.customer_phone && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="flex items-center gap-1 text-[11px]">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {order.customer_phone}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Side: Total & Next State Action Button */}
              <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                <div className="text-left sm:text-right">
                  <p className="text-xs text-slate-400 font-medium">Order Total</p>
                  <p className="text-base font-black text-slate-900 tracking-tight">
                    {formatCurrency(order.total_amount)}
                  </p>
                </div>

                {/* State Transition Actions */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectOrder(order)}
                    title="View details"
                  >
                    <Eye className="w-4 h-4" />
                  </Button>

                  {order.status === 'Received' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onUpdateStatus(order.id, 'Packed')}
                      className="bg-sky-600 hover:bg-sky-700 shadow-sky-600/20 text-xs"
                    >
                      <Package className="w-3.5 h-3.5" />
                      Mark Packed
                    </Button>
                  )}

                  {order.status === 'Packed' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onUpdateStatus(order.id, 'Delivered')}
                      className="bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20 text-xs"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      Mark Delivered
                    </Button>
                  )}

                  {order.status === 'Delivered' && (
                    <div className="flex items-center gap-1 text-emerald-600 text-xs font-bold px-2 py-1 bg-emerald-50 rounded-xl">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Delivered
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
