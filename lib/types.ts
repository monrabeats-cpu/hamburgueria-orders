export type OrderStatus =
  | 'received'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

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
  created_at: string;
  updated_at: string;
}

export const STATUS_FLOW: OrderStatus[] = [
  'received',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Preparando',
  ready: 'Pronto',
  out_for_delivery: 'Em Entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export const STATUS_COLORS: Record<OrderStatus, string> = {
  received: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-indigo-100 text-indigo-800',
  preparing: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  out_for_delivery: 'bg-orange-100 text-orange-800',
  delivered: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-800',
};
