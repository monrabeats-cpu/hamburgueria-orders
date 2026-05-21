import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio';
import twilio from 'twilio';
import { callGeminiAgent } from '@/lib/gemini';
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if customer already has an active order today
  const { data: activeOrder } = await supabase
    .from('orders')
    .select('id, status')
    .eq('whatsapp_number', from)
    .not('status', 'in', '("delivered","cancelled")')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let replyBody: string | null = null;
  let targetOrderId: string | null = activeOrder?.id ?? null;

  if (activeOrder) {
    // Customer has active order — log message silently, proactive notifications handle updates
  } else {
    // No active order — let LLM agent handle the conversation
    // History starts from after the last order to avoid contaminating with old sessions
    const { data: lastOrder } = await supabase
      .from('orders')
      .select('created_at')
      .eq('whatsapp_number', from)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sessionStart = lastOrder ? new Date(lastOrder.created_at) : today;

    const { data: previousMessages } = await supabase
      .from('messages')
      .select('direction, content')
      .eq('whatsapp_number', from)
      .gt('created_at', sessionStart.toISOString())
      .order('created_at', { ascending: true })
      .limit(20);

    const history = (previousMessages ?? []).map((msg) => ({
      role: (msg.direction === 'inbound' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: msg.content }],
    }));

    const { text, orderData } = await callGeminiAgent(history, messageBody);
    replyBody = text;

    if (orderData) {
      const { data: newOrder, error } = await supabase
        .from('orders')
        .insert({
          whatsapp_number: from,
          customer_name: profileName,
          items: orderData.items,
          total: orderData.total,
          status: 'received',
          address: orderData.address ?? null,
          notes: orderData.notes ?? null,
        })
        .select('id')
        .single();

      if (error || !newOrder) {
        console.error('Order insert failed:', error);
        replyBody = 'Desculpe, ocorreu um erro ao registrar seu pedido. Tente novamente.';
      } else {
        targetOrderId = newOrder.id;
      }
    }
  }

  // Log inbound message
  await supabase.from('messages').insert({
    order_id: targetOrderId,
    whatsapp_number: from,
    direction: 'inbound',
    content: messageBody,
  });

  const twimlResponse = new twilio.twiml.MessagingResponse();

  if (replyBody) {
    await supabase.from('messages').insert({
      order_id: targetOrderId,
      whatsapp_number: from,
      direction: 'outbound',
      content: replyBody,
    });
    twimlResponse.message(replyBody);
  }

  return new NextResponse(twimlResponse.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
