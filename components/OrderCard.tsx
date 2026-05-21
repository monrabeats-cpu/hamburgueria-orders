'use client';

import { useState } from 'react';
import { Order, OrderStatus, STATUS_FLOW, STATUS_LABELS } from '@/lib/types';
import StatusBadge from './StatusBadge';

interface OrderCardProps {
  order: Order;
  onStatusChange: (id: string, status: OrderStatus) => void;
}

export default function OrderCard({ order, onStatusChange }: OrderCardProps) {
  const [loading, setLoading] = useState(false);

  const currentIndex = STATUS_FLOW.indexOf(order.status as OrderStatus);
  const nextStatus = currentIndex !== -1 && currentIndex < STATUS_FLOW.length - 1
    ? STATUS_FLOW[currentIndex + 1]
    : null;

  const isTerminal = order.status === 'delivered' || order.status === 'cancelled';

  async function updateStatus(status: OrderStatus) {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data._notificationError) {
          alert(`Status atualizado, mas falha ao notificar cliente:\n${data._notificationError}`);
        }
        onStatusChange(order.id, status);
      }
    } finally {
      setLoading(false);
    }
  }

  const time = new Date(order.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-mono">#{order.id.slice(0, 8)}</p>
          <p className="font-semibold text-slate-900 text-sm truncate mt-0.5">
            {order.customer_name ?? order.whatsapp_number}
          </p>
          <p className="text-xs text-slate-400">{time}</p>
        </div>
        <StatusBadge status={order.status} size="sm" />
      </div>

      {order.items.length > 0 && (
        <ul className="mb-3 space-y-1 border-t border-slate-50 pt-2">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between text-sm">
              <span className="text-slate-700">
                <span className="font-medium">{item.quantity}x</span> {item.name}
              </span>
              <span className="text-slate-400 text-xs">
                R${(item.price * item.quantity).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {order.address && (
        <p className="text-xs text-slate-500 mb-1 line-clamp-2">
          <span className="font-medium text-slate-600">Endereco: </span>
          {order.address}
        </p>
      )}

      {order.notes && (
        <p className="text-xs text-slate-400 italic mb-2">{order.notes}</p>
      )}

      {order.total != null && (
        <p className="text-sm font-bold text-slate-900 mt-2">
          Total: R$ {order.total.toFixed(2)}
        </p>
      )}

      {!isTerminal && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
          {nextStatus && (
            <button
              onClick={() => updateStatus(nextStatus)}
              disabled={loading}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-200 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              {loading ? '...' : STATUS_LABELS[nextStatus]}
            </button>
          )}
          <button
            onClick={() => updateStatus('cancelled')}
            disabled={loading}
            className="px-3 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
