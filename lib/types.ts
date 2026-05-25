export type OrderStatus =
  | 'revisao'
  | 'aguardando_pagamento'
  | 'pago'
  | 'received'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'expirado';

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  whatsapp_number: string;
  customer_name: string | null;
  items: OrderItem[];
  total: number | null;
  status: OrderStatus;
  notes: string | null;
  address: string | null;
  delivery_fee?: number | null;
  delivery_type?: 'entrega' | 'retirada' | null;
  pix_transaction_id?: string | null;
  pix_qrcode?: string | null;
  pix_copia_cola?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

// Full operational flow: Revisão → Aguardando PIX → Pago → Preparando → Em Entrega → Entregue
export const STATUS_FLOW: OrderStatus[] = [
  'revisao',
  'aguardando_pagamento',
  'pago',
  'preparing',
  'out_for_delivery',
  'delivered',
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  revisao: 'Em Revisão',
  aguardando_pagamento: 'Aguardando PIX',
  pago: 'Pago',
  received: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Preparando',
  ready: 'Pronto',
  out_for_delivery: 'Em Entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  expirado: 'Expirado',
};

export const STATUS_COLORS: Record<OrderStatus, string> = {
  revisao: 'bg-purple-100 text-purple-800',
  aguardando_pagamento: 'bg-yellow-100 text-yellow-800',
  pago: 'bg-emerald-100 text-emerald-800',
  received: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-indigo-100 text-indigo-800',
  preparing: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  out_for_delivery: 'bg-orange-100 text-orange-800',
  delivered: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-800',
  expirado: 'bg-slate-100 text-slate-500',
};
