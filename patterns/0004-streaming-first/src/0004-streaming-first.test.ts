import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Streaming First', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Streaming First!');
  });
});
