import { MercadoPagoConfig, Payment } from 'mercadopago';
import { OrderItem } from './types';

interface PixTransactionData {
  qr_code?: string | null;
  qr_code_base64?: string | null;
}

export interface PixPaymentResult {
  transactionId: string;
  qrCode: string;
  copiaECola: string;
  expiresAt: string;
}

export interface CreatePixParams {
  orderId: string;
  amount: number;
  customerName: string | null;
  customerPhone: string;
  items: OrderItem[];
}

let _mpClient: MercadoPagoConfig | null = null;

function getMpClient(): MercadoPagoConfig {
  if (!_mpClient) {
    _mpClient = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN!,
    });
  }
  return _mpClient;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status && status < 500) throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function createPixPayment(params: CreatePixParams): Promise<PixPaymentResult> {
  const payment = new Payment(getMpClient());
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const description = params.items
    .map((i) => `${i.quantity}x ${i.name}`)
    .join(', ')
    .slice(0, 200) || 'Pedido hamburgueria';

  const response = await withRetry(() =>
    payment.create({
      body: {
        transaction_amount: params.amount,
        description,
        payment_method_id: 'pix',
        date_of_expiration: expiresAt.toISOString(),
        external_reference: params.orderId,
        payer: {
          email: `${params.customerPhone.replace(/\D/g, '')}@cliente.hamburgueria.app`,
          first_name: params.customerName?.split(' ')[0] ?? 'Cliente',
        },
      },
    }),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txData: PixTransactionData | undefined = (response as any)
    ?.point_of_interaction?.transaction_data;

  if (!response.id || !txData?.qr_code) {
    throw new Error(`MP returned incomplete PIX data for order ${params.orderId}`);
  }

  console.log(
    JSON.stringify({
      event: 'pix_created',
      orderId: params.orderId,
      transactionId: response.id,
      amount: params.amount,
      expiresAt: expiresAt.toISOString(),
    }),
  );

  return {
    transactionId: String(response.id),
    qrCode: txData.qr_code_base64 ?? '',
    copiaECola: txData.qr_code,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getPaymentById(transactionId: string) {
  const payment = new Payment(getMpClient());
  return payment.get({ id: Number(transactionId) });
}
