import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Perma-Beta', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Perma-Beta!');
  });
});
