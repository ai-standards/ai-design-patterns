import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Lazy Consensus', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Lazy Consensus!');
  });
});
