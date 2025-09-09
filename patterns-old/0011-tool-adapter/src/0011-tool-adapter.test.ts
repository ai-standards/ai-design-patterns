import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Tool Adapter', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Tool Adapter!');
  });
});
