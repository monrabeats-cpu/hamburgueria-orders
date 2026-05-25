'use client';

import { useState } from 'react';
import { Order, OrderStatus, STATUS_FLOW, STATUS_LABELS } from '@/lib/types';
import StatusBadge from './StatusBadge';

interface OrderCardProps {
  order: Order;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onOrderUpdate?: (id: string, updates: Partial<Order>) => void;
}

export default function OrderCard({ order, onStatusChange, onOrderUpdate }: OrderCardProps) {
  const [loading, setLoading] = useState(false);
  const [notifStatus, setNotifStatus] = useState<'sent' | 'skipped' | 'error' | null>(null);

  // Review flow state
  const [deliveryFee, setDeliveryFee] = useState<string>('');
  const [pixError, setPixError] = useState<string | null>(null);

  // Inline edit state
  const [editingAddress, setEditingAddress] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [addressValue, setAddressValue] = useState(order.address ?? '');
  const [notesValue, setNotesValue] = useState(order.notes ?? '');

  const currentIndex = STATUS_FLOW.indexOf(order.status as OrderStatus);
  const nextStatus =
    currentIndex !== -1 && currentIndex < STATUS_FLOW.length - 1
      ? STATUS_FLOW[currentIndex + 1]
      : null;

  const isTerminal = order.status === 'delivered' || order.status === 'cancelled';
  const isRevisao = order.status === 'revisao';
  const isAguardandoPix = order.status === 'aguardando_pagamento';

  const ADVANCE_LABELS: Partial<Record<OrderStatus, string>> = {
    pago: '✓ Confirmar Pagamento',
    preparing: '👨‍🍳 Iniciar Preparo',
    out_for_delivery: '🛵 Saiu para Entrega',
    delivered: '✓ Entregue',
  };

  async function updateStatus(status: OrderStatus) {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok) {
        const debug: string = data._notificationDebug ?? '';
        if (debug.startsWith('sent')) setNotifStatus('sent');
        else if (debug.startsWith('skipped')) setNotifStatus('skipped');
        else if (debug.startsWith('error')) setNotifStatus('error');
        setTimeout(() => onStatusChange(order.id, status), 1200);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGerarPix() {
    const fee = parseFloat(deliveryFee.replace(',', '.'));
    if (isNaN(fee) || fee < 0) {
      setPixError('Informe uma taxa válida (0 para retirada)');
      return;
    }
    setPixError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/gerar-pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_fee: fee }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPixError(data.error ?? 'Erro ao gerar PIX');
        return;
      }
      onOrderUpdate?.(order.id, {
        delivery_fee: data.delivery_fee,
        total: data.total,
        pix_copia_cola: data.pix_copia_cola,
        pix_qrcode: data.pix_qrcode,
        expires_at: data.expires_at,
        status: 'aguardando_pagamento',
      });
      onStatusChange(order.id, 'aguardando_pagamento');
    } finally {
      setLoading(false);
    }
  }

  async function saveField(field: 'address' | 'notes', value: string) {
    const res = await fetch(`/api/orders/${order.id}/update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value || null }),
    });
    if (res.ok) {
      onOrderUpdate?.(order.id, { [field]: value || null });
    }
    if (field === 'address') setEditingAddress(false);
    if (field === 'notes') setEditingNotes(false);
  }

  const time = new Date(order.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  const subtotal = order.items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const feeNum = deliveryFee !== '' ? parseFloat(deliveryFee.replace(',', '.')) : null;
  const feeValid = feeNum !== null && !isNaN(feeNum) && feeNum >= 0;
  const isRetirada = feeNum === 0;
  const previewTotal = feeValid ? subtotal + feeNum : null;

  const aiDeliveryType = order.delivery_type;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-mono">#{order.id.slice(0, 8)}</p>
          <p className="font-semibold text-slate-900 text-sm truncate mt-0.5">
            {order.customer_name ?? order.whatsapp_number}
          </p>
          <p className="text-xs text-slate-400" suppressHydrationWarning>
            {time}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={order.status} size="sm" />
          {aiDeliveryType && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              aiDeliveryType === 'retirada'
                ? 'bg-blue-50 text-blue-700'
                : 'bg-orange-50 text-orange-700'
            }`}>
              {aiDeliveryType === 'retirada' ? '📦 Retirada' : '🛵 Entrega'}
            </span>
          )}
        </div>
      </div>

      {/* Items */}
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

      {/* Address */}
      {isRevisao ? (
        <div className="mb-2">
          {editingAddress ? (
            <div className="flex gap-1">
              <input
                className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                value={addressValue}
                onChange={(e) => setAddressValue(e.target.value)}
                placeholder="Endereço completo"
              />
              <button
                onClick={() => saveField('address', addressValue)}
                className="text-xs text-green-600 font-semibold px-2"
              >
                ✓
              </button>
              <button
                onClick={() => setEditingAddress(false)}
                className="text-xs text-slate-400 px-1"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingAddress(true)}
              className="w-full text-left text-xs text-slate-500 hover:bg-slate-50 rounded px-1 py-0.5 group"
            >
              <span className="font-medium text-slate-600">Endereco: </span>
              {order.address ?? (
                <span className="italic text-slate-400">Clique para adicionar</span>
              )}
              <span className="text-slate-300 group-hover:text-slate-500 ml-1">✎</span>
            </button>
          )}
        </div>
      ) : (
        order.address && (
          <p className="text-xs text-slate-500 mb-1 line-clamp-2">
            <span className="font-medium text-slate-600">Endereco: </span>
            {order.address}
          </p>
        )
      )}

      {/* Notes */}
      {isRevisao ? (
        <div className="mb-2">
          {editingNotes ? (
            <div className="flex gap-1">
              <input
                className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="Observações (ex: sem cebola)"
              />
              <button
                onClick={() => saveField('notes', notesValue)}
                className="text-xs text-green-600 font-semibold px-2"
              >
                ✓
              </button>
              <button
                onClick={() => setEditingNotes(false)}
                className="text-xs text-slate-400 px-1"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingNotes(true)}
              className="w-full text-left text-xs text-slate-400 italic hover:bg-slate-50 rounded px-1 py-0.5 group"
            >
              {order.notes ?? (
                <span className="not-italic text-slate-300">Adicionar observação...</span>
              )}
              <span className="text-slate-300 group-hover:text-slate-400 ml-1 not-italic">✎</span>
            </button>
          )}
        </div>
      ) : (
        order.notes && (
          <p className="text-xs text-slate-400 italic mb-2">{order.notes}</p>
        )
      )}

      {/* Total (non-review states) */}
      {!isRevisao && !isAguardandoPix && order.total != null && (
        <p className="text-sm font-bold text-slate-900 mt-2">
          Total: R$ {order.total.toFixed(2)}
          {order.delivery_fee != null && order.delivery_fee > 0 && (
            <span className="text-xs font-normal text-slate-400 ml-1">
              (taxa R$ {order.delivery_fee.toFixed(2)})
            </span>
          )}
          {order.delivery_fee === 0 && (
            <span className="text-xs font-normal text-blue-500 ml-1">(retirada)</span>
          )}
        </p>
      )}

      {/* ── REVISAO: delivery fee input + PIX button ── */}
      {isRevisao && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex justify-between text-xs text-slate-500 mb-3">
            <span>Subtotal dos itens</span>
            <span className="font-semibold text-slate-700">R$ {subtotal.toFixed(2)}</span>
          </div>

          <div className="mb-3">
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Taxa de entrega
            </label>
            <input
              type="number"
              min="0"
              step="0.50"
              value={deliveryFee}
              onChange={(e) => {
                setDeliveryFee(e.target.value);
                setPixError(null);
              }}
              placeholder="0,00"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">0 = Retirada na loja · &gt;0 = Entrega</p>
          </div>

          {feeValid && (
            <div className={`text-xs font-medium mb-2 px-2 py-1.5 rounded-lg ${
              isRetirada
                ? 'bg-blue-50 text-blue-700'
                : 'bg-orange-50 text-orange-700'
            }`}>
              {isRetirada
                ? `📦 Retirada na loja — Total: R$ ${previewTotal!.toFixed(2)}`
                : `🛵 Entrega — Total: R$ ${previewTotal!.toFixed(2)}`}
            </div>
          )}

          {!feeValid && deliveryFee === '' && (
            <p className="text-[10px] text-amber-600 mb-2">
              ⚠ Preencha a taxa para habilitar geração do PIX
            </p>
          )}

          {pixError && (
            <p className="text-xs text-red-500 mb-2">{pixError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleGerarPix}
              disabled={loading || !feeValid}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-200 disabled:cursor-not-allowed text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              {loading ? '...' : '💳 Gerar PIX'}
            </button>
            <button
              onClick={() => updateStatus('cancelled')}
              disabled={loading}
              className="px-3 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── AGUARDANDO_PAGAMENTO: PIX info + manual confirm ── */}
      {isAguardandoPix && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-slate-500">Total com taxa</span>
            <span className="font-bold text-slate-900">R$ {order.total?.toFixed(2)}</span>
          </div>
          {order.delivery_fee != null && (
            <p className={`text-[10px] font-medium mb-2 ${
              order.delivery_fee === 0 ? 'text-blue-600' : 'text-orange-600'
            }`}>
              {order.delivery_fee === 0
                ? '📦 Retirada na loja'
                : `🛵 Taxa de entrega: R$ ${order.delivery_fee.toFixed(2)}`}
            </p>
          )}
          {order.pix_copia_cola && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-3">
              <p className="text-[10px] text-yellow-700 font-medium mb-1">PIX Copia e Cola:</p>
              <p className="text-[9px] font-mono break-all text-yellow-800 line-clamp-2">
                {order.pix_copia_cola}
              </p>
              <button
                onClick={() => navigator.clipboard.writeText(order.pix_copia_cola!)}
                className="text-[10px] text-yellow-700 hover:text-yellow-900 font-semibold mt-1 underline"
              >
                Copiar código
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => updateStatus('pago')}
              disabled={loading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              {loading ? '...' : '✓ Confirmar Pagamento'}
            </button>
            <button
              onClick={() => updateStatus('cancelled')}
              disabled={loading}
              className="px-3 py-2 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors font-medium"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── NORMAL FLOW: pago → preparing → out_for_delivery ── */}
      {!isTerminal && !isRevisao && !isAguardandoPix && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
          {nextStatus && (
            <button
              onClick={() => updateStatus(nextStatus)}
              disabled={loading}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-200 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              {loading ? '...' : (ADVANCE_LABELS[nextStatus] ?? STATUS_LABELS[nextStatus])}
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

      {/* WhatsApp notification feedback */}
      {notifStatus && (
        <p
          className={`text-xs mt-2 font-medium ${
            notifStatus === 'sent'
              ? 'text-green-600'
              : notifStatus === 'skipped'
                ? 'text-yellow-600'
                : 'text-red-600'
          }`}
        >
          {notifStatus === 'sent' && '✓ WhatsApp enviado'}
          {notifStatus === 'skipped' && '⚠ Sem número no pedido'}
          {notifStatus === 'error' && '✗ Falha ao enviar WhatsApp'}
        </p>
      )}
    </div>
  );
}
