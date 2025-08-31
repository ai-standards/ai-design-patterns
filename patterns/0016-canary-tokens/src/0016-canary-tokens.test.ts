import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Canary Tokens', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Canary Tokens!');
  });
});
