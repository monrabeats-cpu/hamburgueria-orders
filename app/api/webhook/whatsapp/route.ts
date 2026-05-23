import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio';
import twilio from 'twilio';
import { callGroqAgent } from '@/lib/groq';
import { createServiceClient } from '@/lib/supabase/server';
import { OrderStatus } from '@/lib/types';
import { getActiveOrderReply } from '@/lib/notifications';
import { createOrderWithPix } from '@/lib/orderService';

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
    return new NextResponse('Bad Request', { status: 400 });
  }

  const supabase = createServiceClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    const { data: lastOrder } = await supabase
      .from('orders')
      .select('created_at, items, total')
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

    const lastOrderContext = lastOrder
      ? { items: lastOrder.items as { name: string; quantity: number; price: number }[], total: lastOrder.total as number }
      : null;

    try {
      const { text, orderData } = await callGroqAgent(history, messageBody, lastOrderContext);
      replyBody = text;

      if (orderData) {
        try {
          const result = await createOrderWithPix({
            whatsappNumber: from,
            customerName: profileName,
            items: orderData.items,
            total: orderData.total,
            address: orderData.address ?? null,
            notes: orderData.notes ?? null,
          });

          targetOrderId = result.orderId;

          const expiresIn = Math.round(
            (new Date(result.pix.expiresAt).getTime() - Date.now()) / 60000,
          );

          replyBody = [
            `🍔 *Pedido recebido!*`,
            ``,
            `*Total: R$ ${orderData.total.toFixed(2).replace('.', ',')}*`,
            ``,
            `📱 *PIX Copia e Cola:*`,
            result.pix.copiaECola,
            ``,
            `⏰ Expira em ${expiresIn} minuto${expiresIn !== 1 ? 's' : ''}`,
            ``,
            `Após o pagamento, seu pedido entrará em preparo automaticamente! ✅`,
          ].join('\n');
        } catch (pixErr) {
          // PIX failed — fall back to creating a regular order so it isn't lost
          console.error('PIX creation failed, falling back to regular order:', pixErr);

          const { data: newOrder, error: orderError } = await supabase
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

          if (orderError || !newOrder) {
            console.error('Fallback order insert failed:', orderError);
            replyBody = 'Desculpe, ocorreu um erro ao registrar seu pedido. Tente novamente.';
          } else {
            targetOrderId = newOrder.id;
            replyBody =
              'Pedido confirmado! 🍔 Houve uma instabilidade no PIX, mas seu pedido foi registrado. Nossa equipe entrará em contato para combinar o pagamento.';
          }
        }
      }
    } catch (err) {
      console.error('LLM error:', err);
      replyBody = 'Olá! Estou com uma instabilidade agora. Por favor, tente novamente em instantes. 🙏';
    }
  }

  // Log inbound message (non-blocking — never crash the webhook on DB errors)
  supabase.from('messages').insert({
    order_id: targetOrderId,
    whatsapp_number: from,
    direction: 'inbound',
    content: messageBody,
  }).then(({ error }) => { if (error) console.error('Message log failed (inbound):', error); });

  const twimlResponse = new twilio.twiml.MessagingResponse();

  if (replyBody) {
    supabase.from('messages').insert({
      order_id: targetOrderId,
      whatsapp_number: from,
      direction: 'outbound',
      content: replyBody,
    }).then(({ error }) => { if (error) console.error('Message log failed (outbound):', error); });

    twimlResponse.message(replyBody);
  }

  return new NextResponse(twimlResponse.toString(), {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
