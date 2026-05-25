import { describe, it, expect } from 'vitest';
import { MENU_ITEMS, cleanContent } from '../lib/groq';

// ─── MENU_ITEMS ────────────────────────────────────────────────────────────────

describe('MENU_ITEMS', () => {
  it('contains expected items', () => {
    expect(MENU_ITEMS['X-Burguer']).toBe(22.9);
    expect(MENU_ITEMS['X-Bacon']).toBe(27.9);
    expect(MENU_ITEMS['X-Vegano']).toBe(26.9);
  });

  it('has no zero-price items', () => {
    for (const [name, price] of Object.entries(MENU_ITEMS)) {
      expect(price, `${name} has zero price`).toBeGreaterThan(0);
    }
  });

  it('has at least 10 items', () => {
    expect(Object.keys(MENU_ITEMS).length).toBeGreaterThanOrEqual(10);
  });

  it('all prices are finite positive numbers', () => {
    for (const [name, price] of Object.entries(MENU_ITEMS)) {
      expect(Number.isFinite(price), `${name} price is not finite`).toBe(true);
      expect(price, `${name} price should be > 0`).toBeGreaterThan(0);
    }
  });

  it('contains common beverages', () => {
    expect(MENU_ITEMS['Coca-Cola Lata']).toBeDefined();
    expect(MENU_ITEMS['Agua']).toBeDefined();
  });

  it('contains fries in different sizes', () => {
    expect(MENU_ITEMS['Batata Frita P']).toBe(8.9);
    expect(MENU_ITEMS['Batata Frita M']).toBe(12.9);
    expect(MENU_ITEMS['Batata Frita G']).toBe(16.9);
    // Price must increase with size
    expect(MENU_ITEMS['Batata Frita G']).toBeGreaterThan(MENU_ITEMS['Batata Frita M']!);
    expect(MENU_ITEMS['Batata Frita M']).toBeGreaterThan(MENU_ITEMS['Batata Frita P']!);
  });
});

// ─── cleanContent ──────────────────────────────────────────────────────────────

describe('cleanContent', () => {
  it('returns clean text unchanged', () => {
    const clean = 'Olá! Como posso ajudar?';
    expect(cleanContent(clean)).toBe('Olá! Como posso ajudar?');
  });

  it('removes <function=...> XML artifacts', () => {
    const dirty = 'Texto antes <function=criar_pedido>{"items":[]}</function> texto depois';
    const result = cleanContent(dirty);
    expect(result).not.toContain('<function=');
    expect(result).not.toContain('criar_pedido');
    expect(result).toContain('Texto antes');
    expect(result).toContain('texto depois');
  });

  it('removes [TOOL_CALLS] and everything after', () => {
    const dirty = 'Resumo do pedido [TOOL_CALLS] {"tool":"criar_pedido","args":{}}';
    const result = cleanContent(dirty);
    expect(result).not.toContain('[TOOL_CALLS]');
    expect(result).not.toContain('criar_pedido');
    expect(result).toBe('Resumo do pedido');
  });

  it('removes <tool_call> XML tags', () => {
    const dirty = 'Vou registrar <tool_call>{"name":"criar_pedido"}</tool_call> agora';
    const result = cleanContent(dirty);
    expect(result).not.toContain('<tool_call>');
    expect(result).not.toContain('criar_pedido');
  });

  it('trims leading and trailing whitespace', () => {
    expect(cleanContent('  olá  ')).toBe('olá');
    expect(cleanContent('\n\ntexto\n\n')).toBe('texto');
  });

  it('handles empty string', () => {
    expect(cleanContent('')).toBe('');
  });

  it('handles multi-line tool call artifacts', () => {
    const dirty = 'Antes\n<function=criar_pedido>\n{"items": [{"name": "X-Bacon"}]}\n</function>\nDepois';
    const result = cleanContent(dirty);
    expect(result).not.toContain('X-Bacon');
    expect(result).not.toContain('<function=');
    expect(result).toContain('Antes');
    expect(result).toContain('Depois');
  });

  it('returns empty string when content is entirely a tool-call artifact', () => {
    // When the LLM puts the tool call in content instead of tool_calls field,
    // cleanContent strips everything — caller must apply fallback
    const onlyArtifact = '<function=criar_pedido>{"items":[],"total":0,"delivery_type":"entrega"}</function>';
    expect(cleanContent(onlyArtifact)).toBe('');
  });
});
