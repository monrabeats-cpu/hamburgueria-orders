import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { OrderStatus, STATUS_FLOW } from '@/lib/types';
import { sendWhatsAppMessage } from '@/lib/twilio';
import { getNotificationMessage } from '@/lib/notifications';

const VALID_STATUSES = new Set<string>([...STATUS_FLOW, 'cancelled']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const body = await request.json() as { status: OrderStatus };

  if (!VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'Status invalido' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from('orders')
    .update({ status: body.status })
    .eq('id', id)
    .select('id, whatsapp_number, status')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notification = getNotificationMessage(body.status);
  let notificationDebug: string;

  if (!notification) {
    notificationDebug = `skipped: no message for status "${body.status}"`;
  } else if (!data.whatsapp_number) {
    notificationDebug = `skipped: whatsapp_number is empty on order`;
  } else {
    try {
      const sid = await sendWhatsAppMessage(data.whatsapp_number, notification);
      await serviceClient.from('messages').insert({
        order_id: data.id,
        whatsapp_number: data.whatsapp_number,
        direction: 'outbound',
        content: notification,
      });
      notificationDebug = `sent: sid=${sid} to=${data.whatsapp_number}`;
    } catch (err) {
      notificationDebug = `error: ${String(err)}`;
      console.error('Status notification failed:', notificationDebug);
    }
  }

  return NextResponse.json({ ...data, _notificationDebug: notificationDebug });
}
