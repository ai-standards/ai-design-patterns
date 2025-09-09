import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Shadow Agents', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Shadow Agents!');
  });
});
