import twilio from 'twilio';

function getClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
}

export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    params,
  );
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<string> {
  const from = process.env.TWILIO_WHATSAPP_NUMBER ?? '';
  const msg = await getClient().messages.create({
    from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    to: `whatsapp:${to}`,
    body,
  });
  return msg.sid;
}
