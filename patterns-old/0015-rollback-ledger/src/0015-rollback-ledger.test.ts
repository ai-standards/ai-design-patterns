import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Rollback Ledger', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Rollback Ledger!');
  });
});
