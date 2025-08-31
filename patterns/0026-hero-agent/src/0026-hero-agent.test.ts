import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('Hero Agent', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from Hero Agent!');
  });
});
