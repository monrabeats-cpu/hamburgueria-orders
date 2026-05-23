import { createServiceClient } from './supabase/server';
import { createPixPayment, PixPaymentResult } from './paymentService';
import { OrderItem } from './types';

export interface CreateOrderWithPixParams {
  whatsappNumber: string;
  customerName: string | null;
  items: OrderItem[];
  total: number;
  address?: string | null;
  notes?: string | null;
}

export interface CreateOrderWithPixResult {
  orderId: string;
  pix: PixPaymentResult;
  isDuplicate: boolean;
}

export async function createOrderWithPix(
  params: CreateOrderWithPixParams,
): Promise<CreateOrderWithPixResult> {
  const supabase = createServiceClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Idempotency: return existing pending-payment order if not yet expired
  const { data: existing } = await supabase
    .from('orders')
    .select('id, pix_copia_cola, pix_qrcode, pix_transaction_id, expires_at')
    .eq('whatsapp_number', params.whatsappNumber)
    .eq('status', 'aguardando_pagamento')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && existing.expires_at && new Date(existing.expires_at) > new Date()) {
    console.log(
      JSON.stringify({
        event: 'duplicate_order_returned',
        orderId: existing.id,
        whatsapp: params.whatsappNumber,
      }),
    );
    return {
      orderId: existing.id,
      pix: {
        transactionId: existing.pix_transaction_id ?? '',
        qrCode: existing.pix_qrcode ?? '',
        copiaECola: existing.pix_copia_cola ?? '',
        expiresAt: existing.expires_at,
      },
      isDuplicate: true,
    };
  }

  // Create order first to get an ID for external_reference
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      whatsapp_number: params.whatsappNumber,
      customer_name: params.customerName,
      items: params.items,
      total: params.total,
      status: 'aguardando_pagamento',
      address: params.address ?? null,
      notes: params.notes ?? null,
    })
    .select('id')
    .single();

  if (orderError || !order) {
    throw new Error(`Failed to create order: ${orderError?.message}`);
  }

  let pix: PixPaymentResult;
  try {
    pix = await createPixPayment({
      orderId: order.id,
      amount: params.total,
      customerName: params.customerName,
      customerPhone: params.whatsappNumber,
      items: params.items,
    });
  } catch (err) {
    // Roll back order so no orphaned aguardando_pagamento record exists
    await supabase.from('orders').delete().eq('id', order.id);
    throw err;
  }

  await supabase
    .from('orders')
    .update({
      pix_transaction_id: pix.transactionId,
      pix_qrcode: pix.qrCode,
      pix_copia_cola: pix.copiaECola,
      expires_at: pix.expiresAt,
    })
    .eq('id', order.id);

  console.log(
    JSON.stringify({
      event: 'order_created_with_pix',
      orderId: order.id,
      transactionId: pix.transactionId,
      amount: params.total,
    }),
  );

  return { orderId: order.id, pix, isDuplicate: false };
}
