import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Context Ledger', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Context Ledger!');
  });
});
