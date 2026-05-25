import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UpdateOrderBody {
  address?: string | null;
  notes?: string | null;
  delivery_fee?: number | null;
}

export async function PATCH(
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

  let body: UpdateOrderBody;
  try {
    body = (await request.json()) as UpdateOrderBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data: order, error: fetchError } = await serviceClient
    .from('orders')
    .select('id, status, pix_transaction_id')
    .eq('id', id)
    .single();

  if (fetchError || !order) {
    return NextResponse.json({ error: 'Pedido nao encontrado' }, { status: 404 });
  }

  // Block edits after PIX has been generated — values are frozen
  if (order.pix_transaction_id) {
    return NextResponse.json(
      { error: 'Pedido com PIX gerado nao pode ser editado' },
      { status: 409 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (body.address !== undefined) updates.address = body.address;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.delivery_fee !== undefined) {
    if (typeof body.delivery_fee === 'number' && body.delivery_fee < 0) {
      return NextResponse.json({ error: 'Taxa de entrega nao pode ser negativa' }, { status: 400 });
    }
    updates.delivery_fee = body.delivery_fee;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
  }

  const { data, error } = await serviceClient
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select('id, address, notes, delivery_fee, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
