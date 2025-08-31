import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Deterministic IO', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Deterministic IO!');
  });
});
