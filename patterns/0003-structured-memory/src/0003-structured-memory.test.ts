import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Structured Memory', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Structured Memory!');
  });
});
