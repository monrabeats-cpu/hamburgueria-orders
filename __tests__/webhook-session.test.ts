import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the WhatsApp webhook session logic (Z-API integration).
 *
 * Key behaviors validated:
 * 1. Session history loads only TODAY's messages (not from previous days)
 * 2. createReviewOrder is called — not createOrderWithPix — when AI returns orderData
 * 3. Active order returns status reply (no new order created)
 * 4. Reply message contains correct content for delivery vs retirada
 * 5. Audio messages are transcribed before being processed
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

interface ZApiPayload {
  phone?: string;
  fromMe?: boolean;
  senderName?: string;
  type?: string;
  text?: { message: string };
  audio?: { audioUrl: string; mimeType: string; seconds: number };
}

function zapiPayload(overrides: Partial<ZApiPayload> = {}): ZApiPayload {
  return {
    phone: '5511999999999',
    fromMe: false,
    senderName: 'João Silva',
    type: 'ReceivedCallback',
    text: { message: 'Quero um X-Bacon' },
    ...overrides,
  };
}

function makeRequest(payload: ZApiPayload) {
  return {
    json: vi.fn().mockResolvedValue(payload),
    headers: { get: vi.fn().mockReturnValue('') },
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

function makeZApiMock() {
  const sentMessages: { phone: string; message: string }[] = [];
  return {
    mock: { sentMessages },
    module: {
      sendZApiMessage: vi.fn().mockImplementation((phone: string, message: string) => {
        sentMessages.push({ phone, message });
        return Promise.resolve();
      }),
    },
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
      transcribeAudio: vi.fn(),
    }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Em processamento'),
    }));
    vi.doMock('@/lib/orderService', () => ({
      createReviewOrder: vi.fn().mockResolvedValue({ orderId: 'new-order' }),
    }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(zapiPayload()) as never, undefined as never);

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
      transcribeAudio: vi.fn(),
    }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder, createOrderWithPix }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Em processamento'),
    }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(zapiPayload()) as never, undefined as never);

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
      transcribeAudio: vi.fn(),
    }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Em processamento'),
    }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(zapiPayload({ text: { message: 'quero retirar' } })) as never, undefined as never);

    const callArg = createReviewOrder.mock.calls[0][0];
    expect(callArg.deliveryType).toBe('retirada');
  });

  it('does NOT call AI when active order already exists', async () => {
    const callGroqAgent = vi.fn();
    const createReviewOrder = vi.fn();

    vi.doMock('@/lib/supabase/server', () =>
      makeSupabaseMock({ id: 'active-1', status: 'revisao' }),
    );
    vi.doMock('@/lib/groq', () => ({ callGroqAgent, transcribeAudio: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('Seu pedido está em revisão!'),
    }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(zapiPayload()) as never, undefined as never);

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
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn(), transcribeAudio: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(makeRequest(zapiPayload()) as never, undefined as never);

    expect(getActiveOrderReply).toHaveBeenCalledWith('revisao');
    expect(response.status).toBe(200);
  });

  it('returns 200 when fromMe is true — outbound echo from Z-API', async () => {
    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn(), transcribeAudio: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn() }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(
      makeRequest(zapiPayload({ fromMe: true })) as never,
      undefined as never,
    );
    expect(response.status).toBe(200);
  });

  it('returns 200 for non-ReceivedCallback events (status updates)', async () => {
    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn(), transcribeAudio: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn() }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(
      makeRequest(zapiPayload({ type: 'DeliveryCallback' })) as never,
      undefined as never,
    );
    expect(response.status).toBe(200);
  });

  it('returns 200 when JSON body is invalid', async () => {
    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent: vi.fn(), transcribeAudio: vi.fn() }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn() }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const badRequest = { json: vi.fn().mockRejectedValue(new SyntaxError('bad json')) };
    const response = await POST(badRequest as never, undefined as never);
    expect(response.status).toBe(200);
  });
});

// ─── Audio transcription ───────────────────────────────────────────────────────

describe('Webhook audio transcription', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('transcribes audio and passes result to callGroqAgent', async () => {
    const transcribeAudio = vi.fn().mockResolvedValue('Quero dois X-Bacon por favor');
    const callGroqAgent = vi.fn().mockResolvedValue({ text: 'Certo!', orderData: null });

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent, transcribeAudio }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn().mockResolvedValue(undefined) }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(
      makeRequest(
        zapiPayload({
          text: undefined,
          audio: { audioUrl: 'https://cdn.z-api.io/audio.ogg', mimeType: 'audio/ogg', seconds: 3 },
        }),
      ) as never,
      undefined as never,
    );

    expect(transcribeAudio).toHaveBeenCalledWith('https://cdn.z-api.io/audio.ogg');
    expect(callGroqAgent).toHaveBeenCalledWith(
      expect.any(Array),
      'Quero dois X-Bacon por favor',
    );
  });

  it('skips message silently when transcription fails and no text', async () => {
    const callGroqAgent = vi.fn();
    const transcribeAudio = vi.fn().mockRejectedValue(new Error('network error'));

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({ callGroqAgent, transcribeAudio }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/zapi', () => ({ sendZApiMessage: vi.fn() }));

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    const response = await POST(
      makeRequest(
        zapiPayload({
          text: undefined,
          audio: { audioUrl: 'https://cdn.z-api.io/audio.ogg', mimeType: 'audio/ogg', seconds: 3 },
        }),
      ) as never,
      undefined as never,
    );

    expect(response.status).toBe(200);
    expect(callGroqAgent).not.toHaveBeenCalled();
  });
});

// ─── Reply message content ─────────────────────────────────────────────────────

describe('Webhook reply message content', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('entrega reply includes subtotal and delivery emoji, no PIX code', async () => {
    const zapi = makeZApiMock();

    const orderData = {
      items: [{ name: 'X-Bacon', quantity: 1, price: 27.9 }],
      total: 27.9,
      delivery_type: 'entrega' as const,
      address: 'Rua José Cândido, 15 - Morro da Glória',
    };

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'ok', orderData }),
      transcribeAudio: vi.fn(),
    }));
    vi.doMock('@/lib/orderService', () => ({
      createReviewOrder: vi.fn().mockResolvedValue({ orderId: 'o1' }),
    }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('em processamento'),
    }));
    vi.doMock('@/lib/zapi', () => zapi.module);

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(makeRequest(zapiPayload()) as never, undefined as never);

    expect(zapi.mock.sentMessages.length).toBe(1);
    const reply = zapi.mock.sentMessages[0].message;
    expect(reply).toContain('27,90');
    expect(reply).toContain('🛵');
    expect(reply.toLowerCase()).not.toContain('copia e cola');
    expect(reply.toLowerCase()).not.toContain('qr code');
    expect(reply).not.toMatch(/[A-Z0-9]{50,}/); // no long alphanumeric PIX strings
  });

  it('retirada reply includes pickup emoji and subtotal', async () => {
    const zapi = makeZApiMock();

    const orderData = {
      items: [{ name: 'X-Vegano', quantity: 1, price: 26.9 }],
      total: 26.9,
      delivery_type: 'retirada' as const,
    };

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'ok', orderData }),
      transcribeAudio: vi.fn(),
    }));
    vi.doMock('@/lib/orderService', () => ({
      createReviewOrder: vi.fn().mockResolvedValue({ orderId: 'o2' }),
    }));
    vi.doMock('@/lib/notifications', () => ({
      getActiveOrderReply: vi.fn().mockReturnValue('em processamento'),
    }));
    vi.doMock('@/lib/zapi', () => zapi.module);

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(
      makeRequest(zapiPayload({ text: { message: 'quero retirar' } })) as never,
      undefined as never,
    );

    expect(zapi.mock.sentMessages.length).toBe(1);
    const reply = zapi.mock.sentMessages[0].message;
    expect(reply).toContain('📦');
    expect(reply).toContain('Retirada');
    expect(reply).toContain('26,90');
  });

  it('sends reply to the correct phone number', async () => {
    const zapi = makeZApiMock();

    vi.doMock('@/lib/supabase/server', () => makeSupabaseMock(null));
    vi.doMock('@/lib/groq', () => ({
      callGroqAgent: vi.fn().mockResolvedValue({ text: 'Olá! Como posso ajudar?', orderData: null }),
      transcribeAudio: vi.fn(),
    }));
    vi.doMock('@/lib/orderService', () => ({ createReviewOrder: vi.fn() }));
    vi.doMock('@/lib/notifications', () => ({ getActiveOrderReply: vi.fn() }));
    vi.doMock('@/lib/zapi', () => zapi.module);

    const { POST } = await import('../app/api/webhook/whatsapp/route');
    await POST(
      makeRequest(zapiPayload({ phone: '5521988887777' })) as never,
      undefined as never,
    );

    expect(zapi.mock.sentMessages[0].phone).toBe('5521988887777');
  });
});
