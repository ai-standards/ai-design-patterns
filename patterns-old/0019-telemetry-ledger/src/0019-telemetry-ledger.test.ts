import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Telemetry Ledger', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Telemetry Ledger!');
  });
});
