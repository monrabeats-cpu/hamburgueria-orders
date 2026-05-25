import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio';
import twilio from 'twilio';
import { callGroqAgent } from '@/lib/groq';
import { createServiceClient } from '@/lib/supabase/server';
import { OrderStatus } from '@/lib/types';
import { getActiveOrderReply } from '@/lib/notifications';
import { createReviewOrder } from '@/lib/orderService';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  if (process.env.NODE_ENV === 'production') {
    const signature = request.headers.get('x-twilio-signature') ?? '';
    const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/whatsapp`;
    if (!validateTwilioSignature(signature, url, params)) {
      console.error('Twilio signature invalid. URL used:', url);
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const from = (params.From ?? '').replace('whatsapp:', '');
  const messageBody = params.Body ?? '';
  const profileName = params.ProfileName ?? null;

  if (!from || !messageBody) {
    // Twilio status callbacks (delivery receipts, read events) hit this endpoint
    // without From/Body — acknowledge them with 200 to prevent Twilio retries
    return new NextResponse('OK', { status: 200 });
  }

  const supabase = createServiceClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if client already has an active order today
  const { data: activeOrder } = await supabase
    .from('orders')
    .select('id, status')
    .eq('whatsapp_number', from)
    .not('status', 'in', '("delivered","cancelled","expirado")')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let replyBody: string | null = null;
  let targetOrderId: string | null = activeOrder?.id ?? null;

  if (activeOrder) {
    replyBody = getActiveOrderReply(activeOrder.status as OrderStatus);
  } else {
    // Load only today's messages — prevents old conversations from polluting context
    // and causing the LLM to reference items from previous sessions
    const { data: previousMessages } = await supabase
      .from('messages')
      .select('direction, content')
      .eq('whatsapp_number', from)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true })
      .limit(20);

    const history = (previousMessages ?? []).map((msg: { direction: string; content: string }) => ({
      role: (msg.direction === 'inbound' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: msg.content }],
    }));

    try {
      const { text, orderData } = await callGroqAgent(history, messageBody);
      replyBody = text;

      if (orderData) {
        try {
          const result = await createReviewOrder({
            whatsappNumber: from,
            customerName: profileName,
            items: orderData.items,
            total: orderData.total,
            deliveryType: orderData.delivery_type,
            address: orderData.address ?? null,
            notes: orderData.notes ?? null,
          });

          targetOrderId = result.orderId;

          const deliveryLine =
            orderData.delivery_type === 'retirada'
              ? '📦 Retirada na loja'
              : `🛵 Entrega — ${orderData.address ?? 'endereço confirmado'}`;

          replyBody = [
            `🍔 *Pedido recebido!*`,
            ``,
            deliveryLine,
            ``,
            `*Subtotal: R$ ${orderData.total.toFixed(2).replace('.', ',')}*`,
            ``,
            `Nossa equipe vai revisar e te enviar o código PIX em instantes! ✅`,
          ].join('\n');
        } catch (err) {
          console.error('Review order creation failed:', err);
          replyBody = 'Desculpe, ocorreu um erro ao registrar seu pedido. Tente novamente.';
        }
      }
    } catch (err) {
      console.error('LLM error:', err);
      replyBody = 'Olá! Estou com uma instabilidade agora. Por favor, tente novamente em instantes. 🙏';
    }
  }

  // Log inbound message (non-blocking — never crash the webhook on DB errors)
  supabase
    .from('messages')
    .insert({
      order_id: targetOrderId,
      whatsapp_number: from,
      direction: 'inbound',
      content: messageBody,
    })
    .then(({ error }: { error: unknown }) => {
      if (error) console.error('Message log failed (inbound):', error);
    });

  const twimlResponse = new twilio.twiml.MessagingResponse();

  if (replyBody) {
    supabase
      .from('messages')
      .insert({
        order_id: targetOrderId,
        whatsapp_number: from,
        direction: 'outbound',
        content: replyBody,
      })
      .then(({ error }: { error: unknown }) => {
        if (error) console.error('Message log failed (outbound):', error);
      });

    twimlResponse.message(replyBody);
  }

  return new NextResponse(twimlResponse.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
