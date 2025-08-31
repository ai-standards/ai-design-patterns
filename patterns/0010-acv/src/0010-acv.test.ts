import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('ACV (Agent / Controller / View)', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from ACV (Agent / Controller / View)!');
  });
});
