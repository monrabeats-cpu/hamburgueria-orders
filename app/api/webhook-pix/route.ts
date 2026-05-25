import { NextRequest, NextResponse } from 'next/server';
import { handlePixWebhook, MpWebhookPayload } from '@/lib/webhookHandler';

export async function POST(request: NextRequest) {
  let payload: MpWebhookPayload;

  try {
    payload = (await request.json()) as MpWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const signature = request.headers.get('x-signature') ?? '';
  const requestId = request.headers.get('x-request-id') ?? '';

  console.log(
    JSON.stringify({
      event: 'pix_webhook_received',
      action: payload.action,
      type: payload.type,
      dataId: payload.data?.id,
    }),
  );

  try {
    const result = await handlePixWebhook(payload, signature, requestId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = String(err);

    if (msg.includes('Invalid MP webhook signature')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (msg.includes('Amount mismatch')) {
      console.error(JSON.stringify({ event: 'pix_webhook_amount_mismatch', error: msg }));
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    console.error(JSON.stringify({ event: 'pix_webhook_error', error: msg }));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
