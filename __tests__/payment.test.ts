import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── test helpers ─────────────────────────────────────────────────────────────

function makeMpResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 123456789,
    status: 'pending',
    transaction_amount: 57.8,
    point_of_interaction: {
      transaction_data: {
        qr_code: 'pix-copia-e-cola-string',
        qr_code_base64: 'base64-qr-code',
      },
    },
    ...overrides,
  };
}

/** Build a chainable Supabase mock where each `from()` call returns values in order. */
function makeSupabase(
  calls: { single?: unknown; maybeSingle?: unknown; eqResult?: unknown }[],
) {
  let callIndex = 0;
  return {
    from: vi.fn().mockImplementation(() => {
      const cfg = calls[callIndex++] ?? {};
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: cfg.eqResult
          ? vi.fn().mockResolvedValue(cfg.eqResult)
          : vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(cfg.single ?? { data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue(cfg.maybeSingle ?? { data: null, error: null }),
        then: vi.fn(),
      };
      return chain;
    }),
  };
}

// ─── paymentService ────────────────────────────────────────────────────────────

describe('paymentService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MP_ACCESS_TOKEN = 'test-token';
  });
  afterEach(() => vi.restoreAllMocks());

  describe('createPixPayment', () => {
    it('creates PIX payment and returns qrCode + copiaECola', async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeMpResponse());

      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() { return { create: mockCreate }; },
      }));

      const { createPixPayment } = await import('../lib/paymentService');

      const result = await createPixPayment({
        orderId: 'order-1',
        amount: 57.8,
        customerName: 'João Silva',
        customerPhone: '+5511999999999',
        items: [{ name: 'X-Burguer', quantity: 2, price: 22.9 }],
      });

      expect(result.transactionId).toBe('123456789');
      expect(result.copiaECola).toBe('pix-copia-e-cola-string');
      expect(result.qrCode).toBe('base64-qr-code');
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('sends correct body to Mercado Pago API', async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeMpResponse());

      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() { return { create: mockCreate }; },
      }));

      const { createPixPayment } = await import('../lib/paymentService');

      await createPixPayment({
        orderId: 'order-2',
        amount: 44.5,
        customerName: 'Maria',
        customerPhone: '+5521988888888',
        items: [{ name: 'X-Bacon', quantity: 1, price: 27.9 }],
      });

      const body = mockCreate.mock.calls[0][0].body;
      expect(body.transaction_amount).toBe(44.5);
      expect(body.payment_method_id).toBe('pix');
      expect(body.external_reference).toBe('order-2');
      expect(body.payer.first_name).toBe('Maria');
      expect(new Date(body.date_of_expiration).getTime()).toBeGreaterThan(Date.now());
    });

    it('throws when MP returns incomplete PIX data (missing qr_code)', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: 99,
        point_of_interaction: { transaction_data: { qr_code: null } },
      });

      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() { return { create: mockCreate }; },
      }));

      const { createPixPayment } = await import('../lib/paymentService');

      await expect(
        createPixPayment({ orderId: 'x', amount: 10, customerName: null, customerPhone: '+5511', items: [] }),
      ).rejects.toThrow('incomplete PIX data');
    });

    it('retries on 5xx error and succeeds on third attempt', async () => {
      const mockCreate = vi
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockRejectedValueOnce({ status: 500 })
        .mockResolvedValue(makeMpResponse());

      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() { return { create: mockCreate }; },
      }));

      const { createPixPayment } = await import('../lib/paymentService');

      const result = await createPixPayment({
        orderId: 'retry-order',
        amount: 20,
        customerName: null,
        customerPhone: '+5511',
        items: [],
      });

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result.transactionId).toBe('123456789');
    });

    it('does not retry on 4xx client errors', async () => {
      const mockCreate = vi.fn().mockRejectedValue({ status: 401 });

      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() { return { create: mockCreate }; },
      }));

      const { createPixPayment } = await import('../lib/paymentService');

      await expect(
        createPixPayment({ orderId: 'x', amount: 10, customerName: null, customerPhone: '+5511', items: [] }),
      ).rejects.toMatchObject({ status: 401 });

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting 3 retry attempts (persistent 5xx / timeout)', async () => {
      const error = { status: 504, message: 'Gateway Timeout' };
      const mockCreate = vi.fn().mockRejectedValue(error);

      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() { return { create: mockCreate }; },
      }));

      const { createPixPayment } = await import('../lib/paymentService');

      await expect(
        createPixPayment({ orderId: 'x', amount: 10, customerName: null, customerPhone: '+5511', items: [] }),
      ).rejects.toMatchObject({ status: 504 });

      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});

// ─── webhookHandler ────────────────────────────────────────────────────────────

describe('webhookHandler', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MP_WEBHOOK_SECRET = 'webhook-secret-test';
    // NODE_ENV is 'test' in Vitest by default — signature validation is skipped
  });
  afterEach(() => vi.restoreAllMocks());

  describe('validateMpSignature', () => {
    it('validates a correct HMAC signature', async () => {
      const crypto = await import('crypto');
      const secret = 'my-secret';
      const ts = '1700000000';
      const dataId = 'pay-99';
      const requestId = 'req-abc';

      const manifest = `id:${dataId};request-id:${requestId};ts:${ts}`;
      const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

      process.env.MP_WEBHOOK_SECRET = secret;
      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() {},
      }));

      const { validateMpSignature } = await import('../lib/webhookHandler');

      expect(validateMpSignature(`ts=${ts},v1=${v1}`, requestId, dataId)).toBe(true);
    });

    it('rejects a tampered signature', async () => {
      process.env.MP_WEBHOOK_SECRET = 'my-secret';
      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() {},
      }));

      const { validateMpSignature } = await import('../lib/webhookHandler');

      expect(validateMpSignature('ts=123,v1=bad0bad0bad0', 'req-1', 'pay-1')).toBe(false);
    });

    it('returns false when no webhook secret is configured', async () => {
      delete process.env.MP_WEBHOOK_SECRET;
      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() {},
      }));

      const { validateMpSignature } = await import('../lib/webhookHandler');

      expect(validateMpSignature('ts=123,v1=abc', 'req', 'pay')).toBe(false);
    });
  });

  describe('handlePixWebhook', () => {
    const validPayload = {
      action: 'payment.updated',
      type: 'payment',
      data: { id: 'tx-1' },
      id: 'notif-1',
    };

    it('ignores non-payment events', async () => {
      vi.doMock('mercadopago', () => ({
        MercadoPagoConfig: function MpConfig() {},
        Payment: function MockPayment() {},
      }));
      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => makeSupabase([]) }));
      vi.doMock('@/lib/twilio', () => ({ sendWhatsAppMessage: vi.fn() }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      const result = await handlePixWebhook(
        { action: 'plan.created', type: 'plan', data: { id: '1' }, id: '1' },
        '',
        '',
      );

      expect(result.processed).toBe(false);
      expect(result.message).toMatch(/Not a payment event/);
    });

    it('returns not-found when no order matches the transaction ID', async () => {
      vi.doMock('@/lib/paymentService', () => ({ getPaymentById: vi.fn() }));
      vi.doMock('@/lib/supabase/server', () => ({
        createServiceClient: () => makeSupabase([{ maybeSingle: { data: null, error: null } }]),
      }));
      vi.doMock('@/lib/twilio', () => ({ sendWhatsAppMessage: vi.fn() }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      const result = await handlePixWebhook(validPayload, '', '');

      expect(result.processed).toBe(false);
      expect(result.message).toMatch(/Order not found/);
    });

    it('is idempotent — skips already-paid orders', async () => {
      vi.doMock('@/lib/paymentService', () => ({ getPaymentById: vi.fn() }));
      vi.doMock('@/lib/supabase/server', () => ({
        createServiceClient: () =>
          makeSupabase([
            {
              maybeSingle: {
                data: { id: 'order-1', whatsapp_number: '+55119', total: 50, status: 'pago' },
                error: null,
              },
            },
          ]),
      }));
      vi.doMock('@/lib/twilio', () => ({ sendWhatsAppMessage: vi.fn() }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      const result = await handlePixWebhook(validPayload, '', '');

      expect(result.processed).toBe(false);
      expect(result.message).toMatch(/Already processed/);
    });

    it('confirms payment: sets status pago and sends WhatsApp', async () => {
      const mockGetPaymentById = vi.fn().mockResolvedValue({
        status: 'approved',
        transaction_amount: 57.8,
      });
      const mockSendWhatsApp = vi.fn().mockResolvedValue('SM-ok');

      vi.doMock('@/lib/paymentService', () => ({ getPaymentById: mockGetPaymentById }));

      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });
      const sbClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              update: mockUpdate,
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'order-2',
                  whatsapp_number: '+5511888888888',
                  total: 57.8,
                  status: 'aguardando_pagamento',
                },
                error: null,
              }),
            };
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));
      vi.doMock('@/lib/twilio', () => ({ sendWhatsAppMessage: mockSendWhatsApp }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      const result = await handlePixWebhook(validPayload, '', '');

      expect(result.processed).toBe(true);
      expect(result.message).toMatch(/Payment confirmed/);
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'pago' });
      expect(mockSendWhatsApp).toHaveBeenCalledWith(
        '+5511888888888',
        expect.stringContaining('Pedido confirmado'),
      );
    });

    it('marks order as expirado when MP payment is cancelled', async () => {
      const mockGetPaymentById = vi.fn().mockResolvedValue({ status: 'cancelled' });

      vi.doMock('@/lib/paymentService', () => ({ getPaymentById: mockGetPaymentById }));

      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });
      const sbClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              update: mockUpdate,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'order-3', whatsapp_number: '+5511777', total: 30, status: 'aguardando_pagamento' },
                error: null,
              }),
            };
          }
          return { insert: vi.fn().mockReturnValue({ then: vi.fn() }) };
        }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));
      vi.doMock('@/lib/twilio', () => ({ sendWhatsAppMessage: vi.fn() }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      const result = await handlePixWebhook(validPayload, '', '');

      expect(result.processed).toBe(true);
      expect(result.message).toMatch(/expired/);
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'expirado' });
    });

    it('throws when received amount does not match expected order total', async () => {
      const mockGetPaymentById = vi.fn().mockResolvedValue({
        status: 'approved',
        transaction_amount: 10.0, // expected 57.8
      });

      vi.doMock('@/lib/paymentService', () => ({ getPaymentById: mockGetPaymentById }));

      const sbClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'order-4', whatsapp_number: '+55116', total: 57.8, status: 'aguardando_pagamento' },
            error: null,
          }),
        }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));
      vi.doMock('@/lib/twilio', () => ({ sendWhatsAppMessage: vi.fn() }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      await expect(handlePixWebhook(validPayload, '', '')).rejects.toThrow('Amount mismatch');
    });

    it('confirms payment even when WhatsApp notification fails', async () => {
      const mockGetPaymentById = vi.fn().mockResolvedValue({
        status: 'approved',
        transaction_amount: 22.9,
      });

      vi.doMock('@/lib/paymentService', () => ({ getPaymentById: mockGetPaymentById }));

      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });
      const sbClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              update: mockUpdate,
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'order-5', whatsapp_number: '+55115', total: 22.9, status: 'aguardando_pagamento' },
                error: null,
              }),
            };
          }
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));
      vi.doMock('@/lib/twilio', () => ({
        sendWhatsAppMessage: vi.fn().mockRejectedValue(new Error('Twilio down')),
      }));

      const { handlePixWebhook } = await import('../lib/webhookHandler');

      const result = await handlePixWebhook(validPayload, '', '');

      expect(result.processed).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'pago' });
    });
  });
});

// ─── orderService ──────────────────────────────────────────────────────────────

describe('orderService', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => vi.restoreAllMocks());

  const baseParams = {
    whatsappNumber: '+5511999999999',
    customerName: 'Ana Costa',
    items: [{ name: 'X-Salada', quantity: 1, price: 19.9 }],
    total: 19.9,
  };

  const pixResult = {
    transactionId: '999',
    qrCode: 'qr-base64',
    copiaECola: 'pix-code-abc',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };

  describe('createOrderWithPix', () => {
    it('creates order and returns PIX data', async () => {
      const mockCreatePix = vi.fn().mockResolvedValue(pixResult);
      vi.doMock('@/lib/paymentService', () => ({ createPixPayment: mockCreatePix }));

      const sbClient = {
        from: vi.fn()
          .mockReturnValueOnce({ // 1. duplicate check
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })
          .mockReturnValueOnce({ // 2. insert order
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'new-order' }, error: null }),
              }),
            }),
          })
          .mockReturnValueOnce({ // 3. update with PIX info
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));

      const { createOrderWithPix } = await import('../lib/orderService');

      const result = await createOrderWithPix(baseParams);

      expect(result.orderId).toBe('new-order');
      expect(result.pix.copiaECola).toBe('pix-code-abc');
      expect(result.isDuplicate).toBe(false);
      expect(mockCreatePix).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'new-order',
        amount: 19.9,
      }));
    });

    it('returns existing order (duplicate prevention) when valid pending order exists', async () => {
      vi.doMock('@/lib/paymentService', () => ({ createPixPayment: vi.fn() }));

      const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const sbClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'existing-order',
              pix_copia_cola: 'existing-pix',
              pix_qrcode: '',
              pix_transaction_id: 'tx-old',
              expires_at: futureExpiry,
            },
            error: null,
          }),
        }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));

      const { createOrderWithPix } = await import('../lib/orderService');

      const result = await createOrderWithPix(baseParams);

      expect(result.isDuplicate).toBe(true);
      expect(result.orderId).toBe('existing-order');
      expect(result.pix.copiaECola).toBe('existing-pix');
    });

    it('rolls back (deletes) the created order when PIX payment fails', async () => {
      const mockCreatePix = vi.fn().mockRejectedValue(new Error('MP gateway down'));
      vi.doMock('@/lib/paymentService', () => ({ createPixPayment: mockCreatePix }));

      const mockDeleteEq = vi.fn().mockResolvedValue({ error: null });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });

      const sbClient = {
        from: vi.fn()
          .mockReturnValueOnce({ // 1. duplicate check
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })
          .mockReturnValueOnce({ // 2. insert order
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'tmp-order' }, error: null }),
              }),
            }),
          })
          .mockReturnValueOnce({ // 3. delete order (rollback)
            delete: mockDelete,
          }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));

      const { createOrderWithPix } = await import('../lib/orderService');

      await expect(createOrderWithPix(baseParams)).rejects.toThrow('MP gateway down');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteEq).toHaveBeenCalledWith('id', 'tmp-order');
    });

    it('persists PIX transaction ID, qrcode, and expires_at on the order', async () => {
      const mockCreatePix = vi.fn().mockResolvedValue(pixResult);
      vi.doMock('@/lib/paymentService', () => ({ createPixPayment: mockCreatePix }));

      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

      const sbClient = {
        from: vi.fn()
          .mockReturnValueOnce({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })
          .mockReturnValueOnce({
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'ord-pix' }, error: null }),
              }),
            }),
          })
          .mockReturnValueOnce({
            update: mockUpdate,
          }),
      };

      vi.doMock('@/lib/supabase/server', () => ({ createServiceClient: () => sbClient }));

      const { createOrderWithPix } = await import('../lib/orderService');

      await createOrderWithPix(baseParams);

      expect(mockUpdate).toHaveBeenCalledWith({
        pix_transaction_id: '999',
        pix_copia_cola: 'pix-code-abc',
        pix_qrcode: 'qr-base64',
        expires_at: pixResult.expiresAt,
      });
    });
  });
});
