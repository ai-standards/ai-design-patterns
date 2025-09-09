import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Black-Box Opaqueness', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Black-Box Opaqueness!');
  });
});
