import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature, sendWhatsAppMessage } from '@/lib/twilio';
import { parseOrder, formatOrderConfirmation } from '@/lib/order-parser';
import { createServiceClient } from '@/lib/supabase/server';
import { OrderStatus } from '@/lib/types';

const STATUS_REPLY: Record<string, string> = {
  received: 'Seu pedido foi recebido e aguarda confirmacao!',
  confirmed: 'Pedido confirmado! Entrara em preparo em instantes.',
  preparing: 'Seu pedido esta sendo preparado com muito cuidado!',
  ready: 'Pedido pronto! Aguardando o entregador.',
  out_for_delivery: 'Seu pedido saiu para entrega. Chegara em breve!',
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Validate Twilio signature in production
  if (process.env.NODE_ENV === 'production') {
    const signature = request.headers.get('x-twilio-signature') ?? '';
    const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/whatsapp`;
    if (!validateTwilioSignature(signature, url, params)) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const from = (params.From ?? '').replace('whatsapp:', '');
  const messageBody = params.Body ?? '';
  const profileName = params.ProfileName ?? null;

  if (!from || !messageBody) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const supabase = createServiceClient();

  // Check if customer already has an active order today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: activeOrder } = await supabase
    .from('orders')
    .select('id, status')
    .eq('whatsapp_number', from)
    .not('status', 'in', '("delivered","cancelled")')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let replyBody: string;
  let targetOrderId: string | null = activeOrder?.id ?? null;

  if (activeOrder) {
    replyBody = STATUS_REPLY[activeOrder.status as OrderStatus] ?? 'Processando seu pedido...';
  } else {
    const parsed = parseOrder(messageBody);

    const { data: newOrder, error } = await supabase
      .from('orders')
      .insert({
        whatsapp_number: from,
        customer_name: profileName,
        items: parsed.items,
        total: parsed.total > 0 ? parsed.total : null,
        status: 'received',
        address: parsed.address,
        notes: parsed.notes,
      })
      .select('id')
      .single();

    if (error || !newOrder) {
      console.error('Order insert failed:', error);
      return new NextResponse('Internal Error', { status: 500 });
    }

    targetOrderId = newOrder.id;
    replyBody = formatOrderConfirmation(parsed.items, parsed.total);
  }

  // Log inbound message
  if (targetOrderId) {
    await supabase.from('messages').insert({
      order_id: targetOrderId,
      whatsapp_number: from,
      direction: 'inbound',
      content: messageBody,
    });
  }

  // Send reply and log outbound
  try {
    await sendWhatsAppMessage(from, replyBody);
    if (targetOrderId) {
      await supabase.from('messages').insert({
        order_id: targetOrderId,
        whatsapp_number: from,
        direction: 'outbound',
        content: replyBody,
      });
    }
  } catch (err) {
    console.error('WhatsApp reply failed:', err);
  }

  return new NextResponse('OK', { status: 200 });
}
