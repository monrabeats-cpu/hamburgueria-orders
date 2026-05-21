'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Order, OrderStatus, STATUS_FLOW, STATUS_LABELS } from '@/lib/types';
import OrderCard from './OrderCard';

interface OrderBoardProps {
  initialOrders: Order[];
}

const BOARD_STATUSES = STATUS_FLOW.filter((s) => s !== 'delivered') as OrderStatus[];

const COLUMN_ACCENT: Record<string, string> = {
  received: 'border-t-blue-400',
  confirmed: 'border-t-indigo-400',
  preparing: 'border-t-amber-400',
  ready: 'border-t-green-400',
  out_for_delivery: 'border-t-orange-400',
};

export default function OrderBoard({ initialOrders }: OrderBoardProps) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const supabase = createClient();

  const updateLocal = useCallback((id: string, status: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status, updated_at: new Date().toISOString() } : o)),
    );
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('orders-board')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders((prev) => {
            const exists = prev.some((o) => o.id === (payload.new as Order).id);
            return exists ? prev : [payload.new as Order, ...prev];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders((prev) =>
            prev.map((o) => (o.id === (payload.new as Order).id ? (payload.new as Order) : o)),
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders((prev) => prev.filter((o) => o.id !== (payload.old as { id: string }).id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const byStatus = (status: OrderStatus) =>
    orders
      .filter((o) => o.status === status)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const activeCount = orders.filter((o) => BOARD_STATUSES.includes(o.status as OrderStatus)).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Pedidos de Hoje</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCount} {activeCount === 1 ? 'pedido ativo' : 'pedidos ativos'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-xs text-slate-500">Atualizacao em tempo real</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
        {BOARD_STATUSES.map((status) => {
          const col = byStatus(status);
          return (
            <div
              key={status}
              className={`bg-slate-100/80 rounded-xl p-3 border-t-4 ${COLUMN_ACCENT[status]}`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-700 text-sm">{STATUS_LABELS[status]}</h3>
                <span className="bg-white text-slate-600 text-xs font-semibold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
                  {col.length}
                </span>
              </div>

              <div className="space-y-3 min-h-[60px]">
                {col.map((order) => (
                  <OrderCard key={order.id} order={order} onStatusChange={updateLocal} />
                ))}
                {col.length === 0 && (
                  <p className="text-center text-slate-400 text-xs py-8">Nenhum pedido</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
