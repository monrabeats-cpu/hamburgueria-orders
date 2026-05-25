import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { createPixPayment } from '@/lib/paymentService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'ID invalido' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { delivery_fee: number };
  try {
    body = (await request.json()) as { delivery_fee: number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.delivery_fee === undefined || body.delivery_fee === null || typeof body.delivery_fee !== 'number') {
    return NextResponse.json({ error: 'Campo delivery_fee obrigatorio' }, { status: 400 });
  }

  if (body.delivery_fee < 0) {
    return NextResponse.json({ error: 'Taxa de entrega nao pode ser negativa' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: order, error: fetchError } = await serviceClient
    .from('orders')
    .select('id, status, total, items, whatsapp_number, customer_name, pix_transaction_id')
    .eq('id', id)
    .single();

  if (fetchError || !order) {
    return NextResponse.json({ error: 'Pedido nao encontrado' }, { status: 404 });
  }

  if (order.status !== 'revisao') {
    return NextResponse.json(
      { error: `Pedido deve estar em revisao para gerar PIX. Status atual: ${order.status}` },
      { status: 409 },
    );
  }

  if (order.pix_transaction_id) {
    return NextResponse.json({ error: 'PIX ja foi gerado para este pedido' }, { status: 409 });
  }

  const subtotal = order.total ?? 0;
  const finalTotal = Number((subtotal + body.delivery_fee).toFixed(2));

  if (finalTotal <= 0) {
    return NextResponse.json(
      { error: 'Total final deve ser maior que zero. Adicione itens ao pedido.' },
      { status: 400 },
    );
  }

  try {
    const pix = await createPixPayment({
      orderId: order.id,
      amount: finalTotal,
      customerName: order.customer_name,
      customerPhone: order.whatsapp_number,
      items: order.items,
    });

    const { error: updateError } = await serviceClient
      .from('orders')
      .update({
        delivery_fee: body.delivery_fee,
        total: finalTotal,
        pix_transaction_id: pix.transactionId,
        pix_qrcode: pix.qrCode,
        pix_copia_cola: pix.copiaECola,
        expires_at: pix.expiresAt,
        status: 'aguardando_pagamento',
      })
      .eq('id', id);

    if (updateError) {
      console.error('PIX update failed after generation:', updateError);
    }

    console.log(
      JSON.stringify({
        event: 'pix_gerado_pelo_dashboard',
        orderId: id,
        transactionId: pix.transactionId,
        deliveryFee: body.delivery_fee,
        total: finalTotal,
      }),
    );

    return NextResponse.json({
      pix_copia_cola: pix.copiaECola,
      pix_qrcode: pix.qrCode,
      expires_at: pix.expiresAt,
      delivery_fee: body.delivery_fee,
      total: finalTotal,
    });
  } catch (err) {
    console.error('PIX generation error:', err);
    return NextResponse.json({ error: 'Falha ao gerar PIX. Verifique as credenciais do Mercado Pago.' }, { status: 500 });
  }
}
