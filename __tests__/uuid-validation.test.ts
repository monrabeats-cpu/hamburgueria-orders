import { describe, it, expect } from 'vitest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('UUID validation', () => {
  it('accepts valid UUID v4', () => {
    expect(UUID_RE.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(UUID_RE.test('')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
  });

  it('rejects SQL injection attempt', () => {
    expect(UUID_RE.test("1'; DROP TABLE orders; --")).toBe(false);
  });

  it('rejects UUID with wrong length', () => {
    expect(UUID_RE.test('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
  });
});
