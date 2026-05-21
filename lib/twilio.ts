import twilio from 'twilio';

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
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

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const client = getClient();
  if (!client || !process.env.TWILIO_WHATSAPP_NUMBER) {
    console.log(`[WhatsApp] Credenciais não configuradas. Mensagem para ${to}: ${body}`);
    return;
  }
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${to}`,
    body,
  });
}
