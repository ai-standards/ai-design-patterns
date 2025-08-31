import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Decision Ledger', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Decision Ledger!');
  });
});
