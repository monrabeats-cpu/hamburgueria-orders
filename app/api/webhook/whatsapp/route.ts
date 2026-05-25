import { NextRequest, NextResponse } from 'next/server';
import { callGroqAgent, transcribeAudio } from '@/lib/groq';
import { createServiceClient } from '@/lib/supabase/server';
import { OrderStatus } from '@/lib/types';
import { getActiveOrderReply } from '@/lib/notifications';
import { createReviewOrder } from '@/lib/orderService';
import { sendZApiMessage } from '@/lib/zapi';

interface ZApiPayload {
  phone?: string;
  fromMe?: boolean;
  senderName?: string;
  type?: string;
  text?: { message: string };
  audio?: { audioUrl: string; mimeType: string; seconds: number };
}

export async function POST(request: NextRequest) {
  let payload: ZApiPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ status: 'ok' });
  }

  // Ignore outbound echoes and non-message events
  if (payload.fromMe || payload.type !== 'ReceivedCallback') {
    return NextResponse.json({ status: 'ok' });
  }

  const from = payload.phone ?? '';
  const profileName = payload.senderName ?? null;

  // Resolve message text — audio takes priority over text if present
  let messageBody = payload.text?.message ?? '';
  if (!messageBody && payload.audio?.audioUrl) {
    try {
      messageBody = await transcribeAudio(payload.audio.audioUrl);
      console.log(JSON.stringify({ event: 'audio_transcribed', chars: messageBody.length }));
    } catch (err) {
      console.error('Audio transcription failed:', err);
    }
  }

  if (!from || !messageBody) {
    return NextResponse.json({ status: 'ok' });
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

    try {
      await sendZApiMessage(from, replyBody);
    } catch (err) {
      console.error('Z-API send failed:', err);
    }
  }

  return NextResponse.json({ status: 'ok' });
}
