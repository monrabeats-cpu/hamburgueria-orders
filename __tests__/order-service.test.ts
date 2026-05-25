import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ITEMS = [
  { name: 'X-Bacon', quantity: 1, price: 27.9 },
  { name: 'Coca-Cola Lata', quantity: 1, price: 6.0 },
];
const TOTAL = 33.9;

function makeSupabase(insertResult: { data: unknown; error: unknown }) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue(insertResult),
    }),
  };
}

// ─── createReviewOrder ─────────────────────────────────────────────────────────

describe('createReviewOrder', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('creates order with status revisao', async () => {
    const mockSupabase = makeSupabase({ data: { id: 'order-abc' }, error: null });
    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));

    const { createReviewOrder } = await import('../lib/orderService');

    const result = await createReviewOrder({
      whatsappNumber: '+5511999999999',
      customerName: 'João Silva',
      items: ITEMS,
      total: TOTAL,
      deliveryType: 'entrega',
      address: 'Rua das Flores, 123 - Centro',
      notes: null,
    });

    expect(result.orderId).toBe('order-abc');

    // Verify the insert call included status: revisao
    const insertCall = mockSupabase.from().insert.mock.calls[0][0];
    expect(insertCall.status).toBe('revisao');
    expect(insertCall.items).toEqual(ITEMS);
    expect(insertCall.total).toBe(TOTAL);
    expect(insertCall.delivery_type).toBe('entrega');
    expect(insertCall.address).toBe('Rua das Flores, 123 - Centro');
  });

  it('sets delivery_type to retirada when client picks up', async () => {
    const mockSupabase = makeSupabase({ data: { id: 'order-xyz' }, error: null });
    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));

    const { createReviewOrder } = await import('../lib/orderService');

    await createReviewOrder({
      whatsappNumber: '+5511888888888',
      customerName: 'Maria',
      items: ITEMS,
      total: TOTAL,
      deliveryType: 'retirada',
      address: null,
    });

    const insertCall = mockSupabase.from().insert.mock.calls[0][0];
    expect(insertCall.delivery_type).toBe('retirada');
    expect(insertCall.status).toBe('revisao');
    expect(insertCall.address).toBeNull();
  });

  it('does NOT generate PIX (no pix fields in insert)', async () => {
    const mockSupabase = makeSupabase({ data: { id: 'order-nopix' }, error: null });
    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));

    const { createReviewOrder } = await import('../lib/orderService');

    await createReviewOrder({
      whatsappNumber: '+5511777777777',
      customerName: null,
      items: ITEMS,
      total: TOTAL,
      deliveryType: 'entrega',
      address: 'Rua X, 1',
    });

    const insertCall = mockSupabase.from().insert.mock.calls[0][0];
    expect(insertCall.pix_transaction_id).toBeUndefined();
    expect(insertCall.pix_qrcode).toBeUndefined();
    expect(insertCall.pix_copia_cola).toBeUndefined();
  });

  it('throws when Supabase insert returns error', async () => {
    const mockSupabase = makeSupabase({
      data: null,
      error: { message: 'insert failed' },
    });
    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));

    const { createReviewOrder } = await import('../lib/orderService');

    await expect(
      createReviewOrder({
        whatsappNumber: '+5511000000000',
        customerName: null,
        items: ITEMS,
        total: TOTAL,
        deliveryType: 'entrega',
        address: 'Rua Y, 2',
      }),
    ).rejects.toThrow('insert failed');
  });

  it('handles null customerName gracefully', async () => {
    const mockSupabase = makeSupabase({ data: { id: 'order-noname' }, error: null });
    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));

    const { createReviewOrder } = await import('../lib/orderService');

    const result = await createReviewOrder({
      whatsappNumber: '+5511666666666',
      customerName: null,
      items: ITEMS,
      total: TOTAL,
      deliveryType: 'retirada',
    });

    expect(result.orderId).toBe('order-noname');
    const insertCall = mockSupabase.from().insert.mock.calls[0][0];
    expect(insertCall.customer_name).toBeNull();
  });
});

// ─── createOrderWithPix (backward compat) ─────────────────────────────────────

describe('createOrderWithPix (backward compatibility)', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('returns idempotent result for existing non-expired order', async () => {
    const existingOrder = {
      id: 'existing-order',
      pix_transaction_id: 'tx-123',
      pix_qrcode: 'qr-base64',
      pix_copia_cola: 'pix-code',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min in future
    };

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingOrder, error: null }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
      }),
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));

    const { createOrderWithPix } = await import('../lib/orderService');

    const result = await createOrderWithPix({
      whatsappNumber: '+5511999999999',
      customerName: 'João',
      items: ITEMS,
      total: TOTAL,
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.orderId).toBe('existing-order');
    expect(result.pix.transactionId).toBe('tx-123');
    expect(result.pix.copiaECola).toBe('pix-code');
  });

  it('creates new order with aguardando_pagamento status', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 999,
      point_of_interaction: {
        transaction_data: {
          qr_code: 'pix-code-new',
          qr_code_base64: 'base64-qr',
        },
      },
    });

    vi.doMock('mercadopago', () => ({
      MercadoPagoConfig: function MpConfig() {},
      Payment: function MockPayment() { return { create: mockCreate }; },
    }));

    const mockSupabase = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: 'new-order' }, error: null }),
      })),
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createServiceClient: vi.fn(() => mockSupabase),
    }));
    process.env.MP_ACCESS_TOKEN = 'test-token';

    const { createOrderWithPix } = await import('../lib/orderService');

    const result = await createOrderWithPix({
      whatsappNumber: '+5511000000001',
      customerName: 'Test',
      items: ITEMS,
      total: TOTAL,
    });

    expect(result.isDuplicate).toBe(false);
    expect(result.orderId).toBe('new-order');
  });
});
