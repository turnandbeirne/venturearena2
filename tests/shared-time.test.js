import { describe, it, expect } from 'vitest';
import { clockTime, clockWords, spanText } from '../src/shared/time.js';

describe('time, said two ways', () => {
  it('a running clock', () => {
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(59_999)).toBe('0:59');
    expect(clockTime(252_000)).toBe('4:12');
    expect(clockTime(3_727_000)).toBe('1:02:07');
    expect(clockTime(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 3h');
    expect(clockTime(-5)).toBe('0:00');
    expect(clockTime(undefined)).toBe('0:00');
    expect(clockWords(252_000)).toBe('4 minutes 12 seconds');
    expect(clockWords(3_660_000)).toBe('1 hour 1 minute');
    expect(clockWords(0)).toBe('0 seconds');
  });
  it('a span of time someone put in', () => {
    expect(spanText(20_000)).toBe('under a minute');
    expect(spanText(12 * 60_000)).toBe('12 min');
    expect(spanText(200 * 60_000)).toBe('3 h 20 min');
    expect(spanText(120 * 60_000)).toBe('2 h');
    expect(spanText(52 * 3_600_000 + 60_000)).toBe('52 h');
    expect(spanText(NaN)).toBe('under a minute');
  });
});
