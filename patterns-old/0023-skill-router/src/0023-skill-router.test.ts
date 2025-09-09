import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Skill Router', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Skill Router!');
  });
});
