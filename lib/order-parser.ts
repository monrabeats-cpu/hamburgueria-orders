import { OrderItem } from './types';

interface ParsedOrder {
  items: OrderItem[];
  address: string | null;
  notes: string | null;
  total: number;
}

const MENU: Record<string, number> = {
  'x-burguer': 22.9,
  'x-bacon': 27.9,
  'x-salada': 19.9,
  'x-frango': 24.9,
  'x-vegano': 26.9,
  'batata frita p': 8.9,
  'batata frita m': 12.9,
  'batata frita g': 16.9,
  'onion rings': 15.9,
  'coca-cola lata': 6.0,
  'coca-cola 600ml': 8.0,
  'suco laranja': 7.9,
  'suco limao': 7.9,
  'agua': 4.0,
  'milk shake': 18.9,
  'cerveja': 9.9,
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function parseOrder(message: string): ParsedOrder {
  const text = message.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const items: OrderItem[] = [];
  let address: string | null = null;
  let notes: string | null = null;

  const addressMatch = text.match(/endereco[:\s]+(.+?)(?:\n|obs|$)/i);
  if (addressMatch) address = addressMatch[1].trim();

  const obsMatch = text.match(/(?:obs|observacao)[:\s]+(.+?)(?:\n|$)/i);
  if (obsMatch) notes = obsMatch[1].trim();

  for (const [itemName, price] of Object.entries(MENU)) {
    const re = new RegExp(`(\\d+)\\s*(?:x\\s*)?${escapeRegex(itemName)}`, 'i');
    const match = text.match(re);
    if (match) {
      items.push({ name: toTitleCase(itemName), quantity: parseInt(match[1]), price });
    } else if (text.includes(itemName)) {
      items.push({ name: toTitleCase(itemName), quantity: 1, price });
    }
  }

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { items, address, notes, total };
}

export function formatOrderConfirmation(items: OrderItem[], total: number): string {
  if (items.length === 0) {
    return (
      'Ola! Seu pedido foi recebido.\n' +
      'Nossa equipe ira confirmar os itens em instantes.\n' +
      'Tempo estimado: 30 a 45 minutos.'
    );
  }

  const lines = items
    .map((i) => `  ${i.quantity}x ${i.name} - R$ ${(i.price * i.quantity).toFixed(2)}`)
    .join('\n');

  return (
    `Pedido recebido com sucesso!\n\n${lines}\n\n` +
    `Total: R$ ${total.toFixed(2)}\n\n` +
    `Aguarde a confirmacao. Tempo estimado: 30 a 45 minutos.\n` +
    `Para consultar o status, envie qualquer mensagem.`
  );
}
