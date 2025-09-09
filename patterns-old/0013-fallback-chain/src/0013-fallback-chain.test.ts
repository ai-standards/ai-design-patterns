import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Fallback Chain', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Fallback Chain!');
  });
});
