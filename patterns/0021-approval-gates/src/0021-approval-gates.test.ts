import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Approval Gates', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Approval Gates!');
  });
});
