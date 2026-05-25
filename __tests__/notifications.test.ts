import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNotificationMessage,
  getActiveOrderReply,
  STATUS_NOTIFICATION,
  STATUS_ACTIVE_REPLY,
} from '../lib/notifications';

// ─── getNotificationMessage ────────────────────────────────────────────────────

describe('getNotificationMessage', () => {
  it('returns message for confirmed', () => {
    const msg = getNotificationMessage('confirmed');
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe('string');
  });

  it('returns null for received (no notification on creation)', () => {
    expect(getNotificationMessage('received')).toBeNull();
  });

  it('returns null for revisao (operator handles communication)', () => {
    expect(getNotificationMessage('revisao')).toBeNull();
  });

  it('returns null for aguardando_pagamento (PIX code sent separately)', () => {
    expect(getNotificationMessage('aguardando_pagamento')).toBeNull();
  });

  it('returns messages for all notifiable statuses', () => {
    const notifiable: Array<keyof typeof STATUS_NOTIFICATION> = [
      'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled',
    ];
    for (const status of notifiable) {
      const msg = getNotificationMessage(status);
      expect(msg, `missing message for status: ${status}`).toBeTruthy();
    }
  });

  it('each message is a non-empty string longer than 10 chars', () => {
    for (const [status, msg] of Object.entries(STATUS_NOTIFICATION)) {
      expect(msg, `empty message for ${status}`).toBeTruthy();
      expect(msg!.length, `too short for ${status}`).toBeGreaterThan(10);
    }
  });
});

// ─── getActiveOrderReply ───────────────────────────────────────────────────────

describe('getActiveOrderReply', () => {
  it('returns a reply for standard active statuses', () => {
    const statuses = ['received', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] as const;
    for (const status of statuses) {
      const reply = getActiveOrderReply(status);
      expect(reply, `missing reply for ${status}`).toBeTruthy();
      expect(reply.length).toBeGreaterThan(5);
    }
  });

  it('returns reply for revisao — client must know order is being reviewed', () => {
    const reply = getActiveOrderReply('revisao');
    expect(reply).toBeTruthy();
    expect(reply.length).toBeGreaterThan(10);
    // Must mention review or PIX so client understands what's happening
    const lower = reply.toLowerCase();
    expect(
      lower.includes('revis') || lower.includes('pix') || lower.includes('instantes'),
      `revisao reply should mention review or PIX: "${reply}"`,
    ).toBe(true);
  });

  it('returns reply for aguardando_pagamento', () => {
    const reply = getActiveOrderReply('aguardando_pagamento');
    expect(reply).toBeTruthy();
    // Must mention PIX or pagamento
    const lower = reply.toLowerCase();
    expect(
      lower.includes('pix') || lower.includes('pagamento'),
      `aguardando_pagamento reply should mention PIX: "${reply}"`,
    ).toBe(true);
  });

  it('returns fallback for delivered (terminal state)', () => {
    const reply = getActiveOrderReply('delivered');
    expect(reply).toBeTruthy();
  });

  it('returns fallback string for any unknown status', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reply = getActiveOrderReply('unknown_status' as any);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });

  it('all active reply messages are non-empty strings', () => {
    for (const [status, msg] of Object.entries(STATUS_ACTIVE_REPLY)) {
      expect(msg, `empty reply for ${status}`).toBeTruthy();
      expect(msg!.length, `too short for ${status}`).toBeGreaterThan(5);
    }
  });
});

// ─── sendWhatsAppMessage integration (mocked) ──────────────────────────────────

describe('sendWhatsAppMessage integration (mocked)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sends correct payload to Twilio', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ sid: 'SM123456' });
    vi.doMock('twilio', () => {
      const fn = Object.assign(vi.fn(() => ({ messages: { create: mockCreate } })), {
        validateRequest: vi.fn(() => true),
      });
      return { default: fn };
    });

    const { sendWhatsAppMessage } = await import('../lib/twilio');

    process.env.TWILIO_WHATSAPP_NUMBER = '+14155238886';
    const sid = await sendWhatsAppMessage('+5511999999999', 'Teste de mensagem');

    expect(mockCreate).toHaveBeenCalledWith({
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+5511999999999',
      body: 'Teste de mensagem',
    });
    expect(sid).toBe('SM123456');
  });

  it('adds whatsapp: prefix to from if missing', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ sid: 'SM789' });
    vi.doMock('twilio', () => {
      const fn = Object.assign(vi.fn(() => ({ messages: { create: mockCreate } })), {
        validateRequest: vi.fn(() => true),
      });
      return { default: fn };
    });

    const { sendWhatsAppMessage } = await import('../lib/twilio');

    process.env.TWILIO_WHATSAPP_NUMBER = '+14155238886';
    await sendWhatsAppMessage('+5511888888888', 'Oi');

    const call = mockCreate.mock.calls[0][0];
    expect(call.from).toBe('whatsapp:+14155238886');
    expect(call.to).toBe('whatsapp:+5511888888888');
  });

  it('does not double-add whatsapp: prefix', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ sid: 'SM999' });
    vi.doMock('twilio', () => {
      const fn = Object.assign(vi.fn(() => ({ messages: { create: mockCreate } })), {
        validateRequest: vi.fn(() => true),
      });
      return { default: fn };
    });

    const { sendWhatsAppMessage } = await import('../lib/twilio');

    process.env.TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
    await sendWhatsAppMessage('+5511777777777', 'Oi');

    const call = mockCreate.mock.calls[0][0];
    expect(call.from).toBe('whatsapp:+14155238886');
    expect(call.from).not.toContain('whatsapp:whatsapp:');
  });
});
