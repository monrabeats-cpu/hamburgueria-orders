import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

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

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${to}`,
    body,
  });
}
