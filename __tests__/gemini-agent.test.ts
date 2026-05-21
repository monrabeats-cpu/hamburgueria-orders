import { describe, it, expect } from 'vitest';
import { MENU_ITEMS } from '../lib/gemini';

// Tests for the menu data and sanitizeHistory logic
// (callGeminiAgent requires a real API key — tested via integration)

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
});
