import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Infinite Debate', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Infinite Debate!');
  });
});
