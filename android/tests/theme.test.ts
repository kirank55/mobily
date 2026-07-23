import { describe, expect, it } from 'vitest';
import { colors, minTouchTarget, spacing } from '../src/ui/tokens';

describe('Soft Console theme contract', () => {
  it('keeps the canonical cross-platform colors', () => {
    expect(colors).toMatchObject({
      canvas: '#F3F0E8',
      surface: '#E9E6DE',
      surfaceRaised: '#DDD9CF',
      ink: '#191917',
      muted: '#625F58',
      border: '#B9B5AA',
      success: '#286748',
      warning: '#7A5918',
      danger: '#963A34',
    });
  });

  it('uses a four-pixel grid and accessible touch targets', () => {
    expect(Object.values(spacing).every((value) => value % 4 === 0)).toBe(true);
    expect(minTouchTarget).toBeGreaterThanOrEqual(44);
  });
});
