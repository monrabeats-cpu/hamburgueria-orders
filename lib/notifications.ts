import { OrderStatus } from './types';

export const STATUS_NOTIFICATION: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Seu pedido foi confirmado! Em instantes começa o preparo. 👍',
  preparing: 'Seu pedido está sendo preparado com carinho! 👨‍🍳',
  ready: 'Pedido pronto! Já vamos chamar o entregador. ✅',
  out_for_delivery: 'Seu pedido saiu para entrega! Chega em breve. 🛵',
  delivered: 'Pedido entregue! Obrigado por escolher a Hamburgueria. Volte sempre! 😊',
  cancelled: 'Seu pedido foi cancelado. Qualquer dúvida, é só chamar aqui.',
};

export const STATUS_ACTIVE_REPLY: Partial<Record<OrderStatus, string>> = {
  revisao:
    'Seu pedido está em revisão! Em breve você receberá o código PIX para pagamento. ⏳',
  aguardando_pagamento:
    'Seu pedido está aguardando o pagamento PIX! Verifique o código que enviamos e efetue o pagamento. ⏰',
  pago: 'Pagamento confirmado! Seu pedido já está na fila de preparo. 🍔',
  received: 'Seu pedido foi recebido e está aguardando confirmação! ⏳',
  confirmed: 'Pedido confirmado! Em breve começa o preparo. 👍',
  preparing: 'Seu pedido está sendo preparado! 👨‍🍳',
  ready: 'Pedido pronto! Aguardando o entregador. ✅',
  out_for_delivery: 'Seu pedido saiu para entrega! Chega em breve. 🛵',
};

export function getNotificationMessage(status: OrderStatus): string | null {
  return STATUS_NOTIFICATION[status] ?? null;
}

export function getActiveOrderReply(status: OrderStatus): string {
  return (
    STATUS_ACTIVE_REPLY[status] ??
    'Seu pedido está sendo processado. Aguarde as atualizações!'
  );
}
