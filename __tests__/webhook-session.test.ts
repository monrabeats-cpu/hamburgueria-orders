import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the WhatsApp webhook session logic.
 *
 * Key behaviors validated:
 * 1. Session history loads only TODAY's messages (not from previous days)
 * 2. createReviewOrder is called — not createOrderWithPix — when AI returns orderData
 * 3. Active order returns status reply (no new order created)
 * 4. Reply message contains correct content for delivery vs retirada
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

function twilioBody(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    From: 'whatsapp:+5511999999999',
    Body: 'Quero um X-Bacon',
    ProfileName: 'João Silva',
    ...overrides,
  }).toString();
}

function makeRequest(body: string) {
  return {
    text: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn().mockReturnValue('') },
  };
}

/** Creates a Twilio mock where MessagingResponse is a proper constructor. */
function makeTwilioMock(capturedMessages: string[] = []) {
  // Must use a regular function (not arrow) so `new` works correctly
  function MockMessagingResponse() {
    return {
      message: function (msg: string) { capturedMessages.push(msg); },
      toString: function () { return '<Response></Response>'; },
    };
  }
  return {
    default: Object.assign(vi.fn(), {
      twiml: { MessagingResponse: MockMessagingResponse },
      validateRequest: vi.fn().mockReturnValue(true),
    }),
  };
}

function makeSupabaseMock(activeOrderData: unknown = null) {
  return {
    createServiceClient: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: activeOrderData }),
        insert: vi.fn().mockReturnThis(),
        then: vi.fn((cb: (val: unknown) => void) => cb({ error: null })),
      })),
    })),
  };
}

// ─── Session start: always today ───────────────────────────────────────────────

describe('Webhook session — message history window', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('queries messages using today as the start date, not a past order date', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let capturedGteValue: string | null = null;

    // Custom supabase mock that captures the gte value used in the messages query
    const supabaseMock = {
      createServiceClient: vi.fn(() => ({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockImplementation((_col: string, val: string) => {
            capturedGteValue = val;
            return supabaseMock.createServiceClient().from();
          }),
          gt: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          insert: vi.fn().mockReturnThis(),
          then: vi.fn((cb: (val: unknown) => void) => cb({ error: null })),
        })),
      })),
    };

    vi.doMock('@/lib/supabase/server', () => supabaseMock);
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'Oi!', orderData: null }),
    }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Em processamento'),
    }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/orderService', () => ({
      createReviewOrder: vi.fn().mockResolvedValue({ orderId: 'new-order' }),
    }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(twilioBody()) as never, undefined as never);

    // The gte filter on messages should use today's start, not an old order's date
    expect(capturedGteValue).not.toBeNull();
    const capturedDate = new Date(capturedGteValue!);
    const diffMs = Math.abs(capturedDate.getTime() - today.getTime());
    expect(diffMs).toBeLessThan(5000); // within 5s of today's midnight
  });
});

// ─── Order creation: createReviewOrder, NOT createOrderWithPix ─────────────────

describe('Webhook order creation — review flow', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('calls createReviewOrder (not createOrderWithPix) when AI returns orderData', async () => {
    const createReviewOrder = vi.fn().mockResolvedValue({ orderId: 'review-order-123' });
    const createOrderWithPix = vi.fn();

    const orderData = {
      items: [{ name: 'X-Bacon', quantity: 1, price: 27.9 }],
      total: 27.9,
      delivery_type: 'entrega' as const,
      address: 'Rua das Flores, 10 - Centro',
    };

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'Pedido recebido!', orderData }),
    }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder, createOrderWithPix }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Em processamento'),
    }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(twilioBody()) as never, undefined as never);

    expect(createReviewOrder).toHaveBeenCalledOnce();
    expect(createOrderWithPix).not.toHaveBeenCalled();

    const callArg = createReviewOrder.mock.calls[0][0];
    expect(callArg.deliveryType).toBe('entrega');
    expect(callArg.address).toBe('Rua das Flores, 10 - Centro');
    expect(callArg.items).toEqual(orderData.items);
    expect(callArg.total).toBe(27.9);
  });

  it('passes delivery_type retirada correctly', async () => {
    const createReviewOrder = vi.fn().mockResolvedValue({ orderId: 'retirada-order' });

    const orderData = {
      items: [{ name: 'X-Burguer', quantity: 2, price: 22.9 }],
      total: 45.8,
      delivery_type: 'retirada' as const,
    };

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'Pedido recebido!', orderData }),
    }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Em processamento'),
    }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(twilioBody({ Body: 'quero retirar' })) as never, undefined as never);

    const callArg = createReviewOrder.mock.calls[0][0];
    expect(callArg.deliveryType).toBe('retirada');
  });

  it('does NOT call AI when active order already exists', async () => {
    const callGroqAgent = vi.fn();
    const createReviewOrder = vi.fn();

    vi.doMock('@/lib/supabase/server', () =>
      makeSupabaseMock({ id: 'active-1', status: 'revisao' }),
    );
    vi.doMock('@/lib/groq', () => ({ callGroqAgent }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Seu pedido está em revisão!'),
    }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(twilioBody()) as never, undefined as never);

    expect(callGroqAgent).not.toHaveBeenCalled();
    expect(createReviewOrder).not.toHaveBeenCalled();
  });
});

// ─── Active order: returns status reply ───────────────────────────────────────

describe('Webhook active order handling', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('returns correct status reply for revisao orders', async () => {
    const getActiveOrderReply = vi.fn().mockReturnValue('Seu pedido está em revisão!');

    vi.doMock('@/lib/supabase/server', () =>
      makeSupabaseMock({ id: 'active-1', status: 'revisao' }),
    );
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(makeRequest(twilioBody()) as never, undefined as never);

    expect(getActiveOrderReply).toHaveBeenCalledWith('revisao');
    expect(response.status).toBe(200);
  });

  it('returns 200 (not 400) when From is missing — Twilio status callback', async () => {
    // Twilio sends status callbacks (delivery/read receipts) to the same endpoint
    // without a From field. We must return 200 or Twilio will keep retrying.
    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/twilio', () => ({ validateTwilioSignature: vi.fn() }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(
      makeRequest(new URLSearchParams({ Body: 'oi' }).toString()) as never,
      undefined as never,
    );
    expect(response.status).toBe(200);
  });

  it('returns 200 when Body is missing — status callback without message body', async () => {
    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/twilio', () => ({ validateTwilioSignature: vi.fn() }));
    vi.doMock('twilio', () => makeTwilioMock());

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(
      makeRequest(
        new URLSearchParams({ From: 'whatsapp:+5511999999999', MessageStatus: 'delivered' }).toString(),
      ) as never,
      undefined as never,
    );
    expect(response.status).toBe(200);
  });
});

// ─── Reply message content ─────────────────────────────────────────────────────

describe('Webhook reply message content', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('entrega reply includes subtotal and delivery emoji, no PIX code', async () => {
    const capturedMessages: string[] = [];

    const orderData = {
      items: [{ name: 'X-Bacon', quantity: 1, price: 27.9 }],
      total: 27.9,
      delivery_type: 'entrega' as const,
      address: 'Rua José Cândido, 15 - Morro da Glória',
    };

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'ok', orderData }),
    }));
    vi.doMock('@/lib/orderService', () => ({
      createReviewOrder: vi.fn().mockResolvedValue({ orderId: 'o1' }),
    }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('em processamento'),
    }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('twilio', () => makeTwilioMock(capturedMessages));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(twilioBody()) as never, undefined as never);

    expect(capturedMessages.length).toBe(1);
    const reply = capturedMessages[0];
    expect(reply).toContain('27,90');
    expect(reply).toContain('🛵');
    // The actual PIX code must NOT be in the reply — it's generated later by the dashboard
    expect(reply.toLowerCase()).not.toContain('copia e cola');
    expect(reply.toLowerCase()).not.toContain('qr code');
    // "PIX" as a word is OK (e.g. "we'll send the PIX"), but the raw code must not be there
    expect(reply).not.toMatch(/[A-Z0-9]{50,}/); // no long alphanumeric PIX strings
  });

  it('retirada reply includes pickup emoji and subtotal', async () => {
    const capturedMessages: string[] = [];

    const orderData = {
      items: [{ name: 'X-Vegano', quantity: 1, price: 26.9 }],
      total: 26.9,
      delivery_type: 'retirada' as const,
    };

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'ok', orderData }),
    }));
    vi.doMock('@/lib/orderService', () => ({
      createReviewOrder: vi.fn().mockResolvedValue({ orderId: 'o2' }),
    }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('em processamento'),
    }));
    vi.doMock('@/lib/twilio', () => ({
      validateTwilioSignature: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('twilio', () => makeTwilioMock(capturedMessages));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(twilioBody({ Body: 'quero retirar' })) as never, undefined as never);

    expect(capturedMessages.length).toBe(1);
    const reply = capturedMessages[0];
    expect(reply).toContain('📦');
    expect(reply).toContain('Retirada');
    expect(reply).toContain('26,90');
  });
});
