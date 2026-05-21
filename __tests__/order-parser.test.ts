import { describe, it, expect } from 'vitest';
import { parseOrder, formatOrderConfirmation } from '../lib/order-parser';

describe('parseOrder', () => {
  it('parses a single item', () => {
    const result = parseOrder('quero 1 x-burguer');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('X-burguer');
    expect(result.items[0].quantity).toBe(1);
    expect(result.items[0].price).toBe(22.9);
  });

  it('parses quantity correctly', () => {
    const result = parseOrder('2 x-bacon');
    expect(result.items[0].quantity).toBe(2);
    expect(result.total).toBeCloseTo(55.8);
  });

  it('parses multiple items', () => {
    const result = parseOrder('1 x-burguer e 2 coca-cola lata');
    expect(result.items.length).toBeGreaterThanOrEqual(2);
  });

  it('parses address', () => {
    const result = parseOrder('1 x-burguer\nendereco: Rua das Flores 123');
    expect(result.address).toBe('rua das flores 123');
  });

  it('parses notes/obs', () => {
    const result = parseOrder('1 x-burguer\nobs: sem cebola');
    expect(result.notes).toBe('sem cebola');
  });

  it('returns empty items for unrecognized message', () => {
    const result = parseOrder('ola, tudo bem?');
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('handles accents in input', () => {
    const result = parseOrder('1 água');
    expect(result.items[0].name).toBe('Agua');
  });

  it('includes item with hyphen formatted correctly', () => {
    const result = parseOrder('1 x-bacon');
    expect(result.items[0].name).toBe('X-bacon');
  });

  it('calculates total correctly for multiple quantities', () => {
    const result = parseOrder('2 x-salada');
    expect(result.total).toBeCloseTo(39.8);
  });
});

describe('formatOrderConfirmation', () => {
  it('returns fallback message when no items', () => {
    const msg = formatOrderConfirmation([], 0);
    expect(msg).toContain('Nossa equipe ira confirmar');
  });

  it('includes item names and total', () => {
    const items = [{ name: 'X-Burguer', quantity: 1, price: 22.9 }];
    const msg = formatOrderConfirmation(items, 22.9);
    expect(msg).toContain('X-Burguer');
    expect(msg).toContain('22.90');
    expect(msg).toContain('Total');
  });

  it('shows correct total for multiple items', () => {
    const items = [
      { name: 'X-Burguer', quantity: 2, price: 22.9 },
      { name: 'Coca-Cola Lata', quantity: 1, price: 6.0 },
    ];
    const msg = formatOrderConfirmation(items, 51.8);
    expect(msg).toContain('51.80');
  });
});
