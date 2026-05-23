import { NextRequest, NextResponse } from 'next/server';
import { createOrderWithPix } from '@/lib/orderService';
import { OrderItem } from '@/lib/types';

interface CreatePaymentBody {
  whatsapp_number: string;
  customer_name?: string | null;
  items: OrderItem[];
  total: number;
  address?: string | null;
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  let body: CreatePaymentBody;

  try {
    body = (await request.json()) as CreatePaymentBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    !body.whatsapp_number ||
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    typeof body.total !== 'number'
  ) {
    return NextResponse.json({ error: 'Missing required fields: whatsapp_number, items, total' }, { status: 400 });
  }

  if (body.total <= 0) {
    return NextResponse.json({ error: 'total must be greater than zero' }, { status: 400 });
  }

  try {
    const result = await createOrderWithPix({
      whatsappNumber: body.whatsapp_number,
      customerName: body.customer_name ?? null,
      items: body.items,
      total: body.total,
      address: body.address ?? null,
      notes: body.notes ?? null,
    });

    console.log(
      JSON.stringify({
        event: 'criar_pagamento_success',
        orderId: result.orderId,
        isDuplicate: result.isDuplicate,
        amount: body.total,
      }),
    );

    return NextResponse.json({
      order_id: result.orderId,
      pix_copia_cola: result.pix.copiaECola,
      pix_qrcode: result.pix.qrCode,
      expires_at: result.pix.expiresAt,
      is_duplicate: result.isDuplicate,
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'criar_pagamento_error', error: String(err) }));
    return NextResponse.json({ error: 'Failed to create PIX payment' }, { status: 500 });
  }
}
