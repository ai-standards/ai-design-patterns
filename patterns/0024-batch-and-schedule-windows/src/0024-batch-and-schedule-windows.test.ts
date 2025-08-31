import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Batch & Schedule Windows', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Batch & Schedule Windows!');
  });
});
