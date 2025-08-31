import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Cost Guardrails', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Cost Guardrails!');
  });
});
