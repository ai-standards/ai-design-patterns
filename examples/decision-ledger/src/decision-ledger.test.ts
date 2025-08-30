import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionLedger } from './decision-ledger.js';

describe('DecisionLedger', () => {
  let ledger: DecisionLedger;

  beforeEach(() => {
    ledger = new DecisionLedger();
  });

  describe('recordDecision', () => {
    it('should record a basic decision', () => {
      const decision = ledger.recordDecision(
        'Test Decision',
        'Choose option A',
        'Option A is better',
        'alice@test.com'
      );

      expect(decision.id).toMatch(/^DEC-\d{3}$/);
      expect(decision.title).toBe('Test Decision');
      expect(decision.decision).toBe('Choose option A');
      expect(decision.rationale).toBe('Option A is better');
      expect(decision.decisionMaker).toBe('alice@test.com');
      expect(decision.status).toBe('active');
      expect(decision.timestamp).toBeInstanceOf(Date);
    });

    it('should record decision with all options', () => {
      const decision = ledger.recordDecision(
        'Complex Decision',
        'Choose framework X',
        'Best performance',
        'bob@test.com',
        {
          alternatives: [
            {
              option: 'Framework Y',
              pros: ['Easy to use'],
              cons: ['Slower'],
              whyRejected: 'Performance concerns'
            }
          ],
          stakeholders: ['alice@test.com', 'charlie@test.com'],
          context: 'Building new feature',
          tags: ['architecture', 'framework']
        }
      );

      expect(decision.alternatives).toHaveLength(1);
      expect(decision.stakeholders).toEqual(['alice@test.com', 'charlie@test.com']);
      expect(decision.context).toBe('Building new feature');
      expect(decision.tags).toEqual(['architecture', 'framework']);
    });

    it('should generate sequential IDs', () => {
      const decision1 = ledger.recordDecision('First', 'A', 'Because', 'alice@test.com');
      const decision2 = ledger.recordDecision('Second', 'B', 'Because', 'bob@test.com');

      expect(decision1.id).toBe('DEC-001');
      expect(decision2.id).toBe('DEC-002');
    });
  });

  describe('updateOutcome', () => {
    it('should update decision outcome', () => {
      const decision = ledger.recordDecision('Test', 'Choose A', 'Best', 'alice@test.com');
      
      ledger.updateOutcome(decision.id, 'Worked great!');
      
      const updated = ledger.getDecision(decision.id);
      expect(updated?.outcome).toBe('Worked great!');
    });

    it('should throw error for non-existent decision', () => {
      expect(() => {
        ledger.updateOutcome('DEC-999', 'Some outcome');
      }).toThrow('Decision DEC-999 not found');
    });
  });

  describe('supersede', () => {
    it('should mark original as superseded', () => {
      const original = ledger.recordDecision('Original', 'A', 'First choice', 'alice@test.com');
      const replacement = ledger.recordDecision('Replacement', 'B', 'Better choice', 'bob@test.com');
      
      ledger.supersede(original.id, replacement);
      
      const updated = ledger.getDecision(original.id);
      expect(updated?.status).toBe('superseded');
      expect(updated?.supersededBy).toBe(replacement.id);
    });
  });

  describe('reverse', () => {
    it('should reverse a decision and create reversal entry', () => {
      const original = ledger.recordDecision('Bad Decision', 'Do X', 'Seemed good', 'alice@test.com');
      
      const reversal = ledger.reverse(original.id, 'X caused problems', 'bob@test.com');
      
      const updated = ledger.getDecision(original.id);
      expect(updated?.status).toBe('reversed');
      expect(updated?.supersededBy).toBe(reversal.id);
      expect(reversal.tags).toContain('reversal');
      expect(reversal.title).toContain('Reversal of');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      ledger.recordDecision('Arch Decision', 'Use React', 'Good library', 'alice@test.com', {
        tags: ['architecture', 'frontend'],
        stakeholders: ['alice@test.com', 'bob@test.com']
      });
      ledger.recordDecision('Process Decision', 'Use Agile', 'Works well', 'bob@test.com', {
        tags: ['process'],
        stakeholders: ['bob@test.com']
      });
    });

    it('should filter by tags', () => {
      const results = ledger.query({ tags: ['architecture'] });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Arch Decision');
    });

    it('should filter by decision maker', () => {
      const results = ledger.query({ decisionMaker: 'bob@test.com' });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Process Decision');
    });

    it('should filter by stakeholder', () => {
      const results = ledger.query({ stakeholder: 'alice@test.com' });
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Arch Decision');
    });

    it('should filter by status', () => {
      const decision = ledger.recordDecision('To Reverse', 'Bad choice', 'Oops', 'alice@test.com');
      ledger.reverse(decision.id, 'Was wrong', 'bob@test.com');
      
      const active = ledger.query({ status: 'active' });
      const reversed = ledger.query({ status: 'reversed' });
      
      expect(active.length).toBeGreaterThan(0);
      expect(reversed).toHaveLength(1);
    });

    it('should search by text', () => {
      const results = ledger.query({ searchText: 'React' });
      
      expect(results).toHaveLength(1);
      expect(results[0].decision).toContain('React');
    });

    it('should return results sorted by newest first', () => {
      const results = ledger.query({});
      
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          results[i + 1].timestamp.getTime()
        );
      }
    });
  });

  describe('getDecision', () => {
    it('should return decision by ID', () => {
      const decision = ledger.recordDecision('Test', 'A', 'Because', 'alice@test.com');
      
      const found = ledger.getDecision(decision.id);
      
      expect(found).toEqual(decision);
    });

    it('should return null for non-existent ID', () => {
      const found = ledger.getDecision('DEC-999');
      
      expect(found).toBeNull();
    });
  });

  describe('getDecisionHistory', () => {
    it('should return decision history chain', () => {
      const original = ledger.recordDecision('Original', 'A', 'First', 'alice@test.com');
      const replacement = ledger.recordDecision('Replacement', 'B', 'Better', 'bob@test.com');
      ledger.supersede(original.id, replacement);
      
      const history = ledger.getDecisionHistory(replacement.id);
      
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe(original.id);
      expect(history[1].id).toBe(replacement.id);
    });

    it('should return empty array for non-existent decision', () => {
      const history = ledger.getDecisionHistory('DEC-999');
      
      expect(history).toEqual([]);
    });
  });

  describe('generateReport', () => {
    it('should generate summary report', () => {
      ledger.recordDecision('Active', 'A', 'Good', 'alice@test.com');
      const toReverse = ledger.recordDecision('To Reverse', 'B', 'Bad', 'bob@test.com');
      ledger.reverse(toReverse.id, 'Was wrong', 'alice@test.com');
      
      const report = ledger.generateReport();
      
      expect(report).toContain('Decision Ledger Report');
      expect(report).toContain('Active decisions: 2'); // Active + reversal decision
      expect(report).toContain('Reversed decisions: 1');
      expect(report).toContain('Total decisions: 3');
    });
  });

  describe('import/export', () => {
    it('should export and import decisions', () => {
      const decision1 = ledger.recordDecision('First', 'A', 'Good', 'alice@test.com');
      const decision2 = ledger.recordDecision('Second', 'B', 'Better', 'bob@test.com');
      
      const exported = ledger.exportDecisions();
      
      const newLedger = new DecisionLedger();
      newLedger.importDecisions(exported);
      
      expect(newLedger.getDecision(decision1.id)).toEqual(decision1);
      expect(newLedger.getDecision(decision2.id)).toEqual(decision2);
      
      // New decisions should continue with correct ID
      const decision3 = newLedger.recordDecision('Third', 'C', 'Best', 'charlie@test.com');
      expect(decision3.id).toBe('DEC-003');
    });
  });

  describe('clear', () => {
    it('should clear all decisions', () => {
      ledger.recordDecision('Test', 'A', 'Good', 'alice@test.com');
      
      ledger.clear();
      
      expect(ledger.query({})).toHaveLength(0);
      
      const newDecision = ledger.recordDecision('New', 'B', 'Fresh', 'bob@test.com');
      expect(newDecision.id).toBe('DEC-001'); // ID counter reset
    });
  });
});
