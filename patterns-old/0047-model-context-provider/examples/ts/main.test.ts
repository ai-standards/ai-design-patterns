
// main.test.ts
import { main, getConfig, buildDemoRequestCtx, getDefaultProviderPlan, composeContext, pruneToTokenBudget, mergeWithPrecedence, logLineage, callModel } from './main';

describe('Healthcare Documentation Copilot', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // Save original environment variables
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  describe('getConfig', () => {
    it('should return default config values when no env variables are set', () => {
      const config = getConfig();
      expect(config.tokenBudget).toBe(800);
      expect(config.strictPrecedence).toBe(false);
    });

    it('should return overridden config values from env variables', () => {
      process.env.TOKEN_BUDGET = '1000';
      process.env.STRICT_PRECEDENCE = 'true';

      const config = getConfig();
      expect(config.tokenBudget).toBe(1000);
      expect(config.strictPrecedence).toBe(true);
    });
  });

  describe('buildDemoRequestCtx', () => {
    it('should build a demo RequestCtx with default values', () => {
      const cfg = { tokenBudget: 800, strictPrecedence: false };
      const ctx = buildDemoRequestCtx(cfg);

      expect(ctx.userId).toBe('u-123');
      expect(ctx.role).toBe('clinician');
      expect(ctx.tenantId).toBe('cedarvale-demo');
      expect(ctx.task).toBe('discharge_summary');
      expect(ctx.specialty).toBe('cardiology');
      expect(ctx.inputText).toContain('Patient: John Smith');
    });
  });

  describe('getDefaultProviderPlan', () => {
    it('should return a correct ordered list of providers', () => {
      const ctx = buildDemoRequestCtx({ tokenBudget: 800, strictPrecedence: false });
      const plan = getDefaultProviderPlan(ctx);

      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].id).toBe('policy');
      expect(plan[1].id).toBe('safety');
      expect(plan.some(p => p.id === 'kb')).toBe(true);
    });
  });

  describe('composeContext', () => {
    it('should compose context from providers', async () => {
      const ctx = buildDemoRequestCtx({ tokenBudget: 800, strictPrecedence: false });
      const plan = getDefaultProviderPlan(ctx);
      const composed = await composeContext(plan, ctx, { tokenBudget: 800, strictPrecedence: false });

      expect(composed.instructions.length).toBeGreaterThan(0);
      expect(composed.lineage.length).toBeGreaterThan(0);
    });

    it('should throw an error if a required provider is missing', async () => {
      const ctx = buildDemoRequestCtx({ tokenBudget: 800, strictPrecedence: false });
      const plan = getDefaultProviderPlan(ctx);
      // Remove the 'policy' provider to simulate a missing required provider
      const modifiedPlan = plan.filter(p => p.id !== 'policy');

      await expect(composeContext(modifiedPlan, ctx, { tokenBudget: 800, strictPrecedence: false }))
        .rejects
        .toThrow('Missing required provider output: policy');
    });
  });

  describe('pruneToTokenBudget', () => {
    it('should prune context to fit within the token budget', () => {
      const ctx = buildDemoRequestCtx({ tokenBudget: 100, strictPrecedence: false });
      const plan = getDefaultProviderPlan(ctx);
      const composed = composeContext(plan, ctx, { tokenBudget: 100, strictPrecedence: false });

      const pruned = pruneToTokenBudget(composed, 100, { keepProviderIds: ['policy', 'safety'] });
      expect(pruned.instructions.length).toBeLessThanOrEqual(100); // Assuming a token estimation function
    });
  });

  describe('callModel', () => {
    it('should simulate a model call and return a formatted response', () => {
      const ctx = buildDemo