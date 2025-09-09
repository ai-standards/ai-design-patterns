import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Eval as Contract', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Eval as Contract!');
  });
});
