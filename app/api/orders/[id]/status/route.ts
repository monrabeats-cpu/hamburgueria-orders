import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OrderStatus, STATUS_FLOW } from '@/lib/types';

const VALID_STATUSES = new Set<string>([...STATUS_FLOW, 'cancelled']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { status: OrderStatus };

  if (!VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'Status invalido' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: body.status })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
