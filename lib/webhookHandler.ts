import crypto from 'crypto';
import { getPaymentById } from './paymentService';
import { createServiceClient } from './supabase/server';
import { sendWhatsAppMessage } from './twilio';

export interface MpWebhookPayload {
  action: string;
  type: string;
  data: { id: string };
  id: string;
  request_id?: string;
  date_created?: string;
  live_mode?: boolean;
}

export function validateMpSignature(
  signature: string,
  requestId: string,
  dataId: string,
): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;

  const parts = Object.fromEntries(
    signature.split(',').map((p) => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx), p.slice(idx + 1)];
    }),
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts}`;
  const hmacBytes = crypto.createHmac('sha256', secret).update(manifest).digest();

  try {
    const v1Bytes = Buffer.from(v1, 'hex');
    if (hmacBytes.length !== v1Bytes.length) return false;
    return crypto.timingSafeEqual(hmacBytes, v1Bytes);
  } catch {
    return false;
  }
}

export async function handlePixWebhook(
  payload: MpWebhookPayload,
  signature: string,
  requestId: string,
): Promise<{ processed: boolean; message: string }> {
  if (payload.type !== 'payment' || !payload.action?.startsWith('payment.')) {
    return { processed: false, message: 'Not a payment event' };
  }

  const transactionId = payload.data?.id;
  if (!transactionId) {
    return { processed: false, message: 'Missing data.id' };
  }

  if (process.env.NODE_ENV === 'production') {
    if (!validateMpSignature(signature, requestId, transactionId)) {
      throw new Error('Invalid MP webhook signature');
    }
  }

  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, whatsapp_number, total, status')
    .eq('pix_transaction_id', transactionId)
    .maybeSingle();

  if (!order) {
    console.log(JSON.stringify({ event: 'webhook_order_not_found', transactionId }));
    return { processed: false, message: 'Order not found for this transaction' };
  }

  // Idempotency: already processed
  if (order.status === 'pago' || order.status === 'expirado') {
    console.log(
      JSON.stringify({ event: 'webhook_already_processed', transactionId, orderId: order.id }),
    );
    return { processed: false, message: 'Already processed' };
  }

  const payment = await getPaymentById(transactionId);

  // Handle expiration / cancellation
  if (payment.status === 'cancelled') {
    await supabase.from('orders').update({ status: 'expirado' }).eq('id', order.id);
    console.log(JSON.stringify({ event: 'pix_expired', orderId: order.id, transactionId }));
    return { processed: true, message: 'Order marked as expired' };
  }

  if (payment.status !== 'approved') {
    console.log(
      JSON.stringify({ event: 'webhook_not_approved', status: payment.status, transactionId }),
    );
    return { processed: false, message: `Payment status: ${payment.status}` };
  }

  // Validate amount
  const expected = Number(order.total);
  const received = Number(payment.transaction_amount);
  if (Math.abs(received - expected) > 0.01) {
    console.error(
      JSON.stringify({
        event: 'pix_amount_mismatch',
        expected,
        received,
        orderId: order.id,
      }),
    );
    throw new Error(`Amount mismatch: expected ${expected}, got ${received}`);
  }

  await supabase.from('orders').update({ status: 'pago' }).eq('id', order.id);

  console.log(
    JSON.stringify({
      event: 'pix_confirmed',
      orderId: order.id,
      transactionId,
      amount: received,
    }),
  );

  const message =
    'Pedido confirmado 🍔\nRecebemos seu pagamento.\nSeu pedido entrou em preparação.';

  try {
    const sid = await sendWhatsAppMessage(order.whatsapp_number, message);
    await supabase.from('messages').insert({
      order_id: order.id,
      whatsapp_number: order.whatsapp_number,
      direction: 'outbound',
      content: message,
    });
    console.log(JSON.stringify({ event: 'whatsapp_pix_confirmation_sent', sid, orderId: order.id }));
  } catch (err) {
    // Non-fatal: payment is confirmed regardless of notification failure
    console.error(
      JSON.stringify({ event: 'whatsapp_pix_confirmation_failed', error: String(err), orderId: order.id }),
    );
  }

  return { processed: true, message: 'Payment confirmed' };
}
