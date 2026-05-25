export async function sendZApiMessage(phone: string, message: string): Promise<void> {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;

  const res = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': clientToken ?? '',
      },
      body: JSON.stringify({ phone, message }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Z-API send-text failed ${res.status}: ${body}`);
  }
}
