import { describe, expect, it } from 'vitest';
import { textWidth, wrapLines } from '../src/measure.js';

// Every expectation here was checked against Chrome's own wrapping of the same string in Arial (21 Sept 2026).
describe('wrapLines', () => {
  it('wraps card text where a browser does, at the grid2 column (230px)', () => {
    expect(wrapLines('36 months · 5,000 miles p.a. · £4,900 initial payment', 12, 230)).toBe(2);
    expect(wrapLines('1.5T SHS-P Luxury 5dr Auto 7 Seater', 13, 230)).toBe(1);
    expect(wrapLines('220kW 82kWh Long Range Single motor Prime 5dr Auto', 13, 230)).toBe(2);
    expect(wrapLines('220kW 82kWh Long Range Single motor Prime Pro Performance 5dr Auto AWD', 13, 230)).toBe(3);
    expect(wrapLines('Q4 e-tron Sportback quattro', 20, 230, true)).toBe(2);
    expect(wrapLines('Kona Electric', 20, 230, true)).toBe(1);
    expect(wrapLines('Processing fee £299.99 inc VAT · Offer valid until 30 September 2026', 11, 230)).toBe(2);
    expect(wrapLines("Processing fee £299.99 inc VAT · Offer valid until 30 September 2026 · Brochure figures are the manufacturer's and may differ from this offer.", 11, 230)).toBe(4);
  });

  it('and at the grid3 column (142px)', () => {
    expect(wrapLines('Q4 e-tron Sportback quattro', 17, 142, true)).toBe(3);
    expect(wrapLines('48 mo · 10k mi · £5,239 initial', 11, 142)).toBe(2);
  });

  it('counts nothing for empty text, and bold runs wider than regular', () => {
    expect(wrapLines('  ', 12, 230)).toBe(0);
    expect(textWidth('Golf', 20, true)).toBeGreaterThan(textWidth('Golf', 20));
  });
});
