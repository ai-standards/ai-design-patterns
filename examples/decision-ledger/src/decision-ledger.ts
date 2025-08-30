import type { DecisionEntry, Alternative, DecisionQuery } from './types.js';

export class DecisionLedger {
  private entries: DecisionEntry[] = [];
  private nextId: number = 1;

  recordDecision(
    title: string,
    decision: string,
    rationale: string,
    decisionMaker: string,
    options: {
      alternatives?: Alternative[];
      stakeholders?: string[];
      context?: string;
      tags?: string[];
    } = {}
  ): DecisionEntry {
    const entry: DecisionEntry = {
      id: `DEC-${this.nextId.toString().padStart(3, '0')}`,
      timestamp: new Date(),
      title,
      decision,
      rationale,
      alternatives: options.alternatives || [],
      decisionMaker,
      stakeholders: options.stakeholders || [],
      context: options.context,
      tags: options.tags || [],
      status: 'active'
    };

    this.entries.push(entry);
    this.nextId++;

    console.log(`Decision recorded: ${entry.id} - ${entry.title}`);
    return entry;
  }

  updateOutcome(decisionId: string, outcome: string): void {
    const entry = this.entries.find(e => e.id === decisionId);
    if (!entry) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    entry.outcome = outcome;
    console.log(`Outcome updated for ${decisionId}: ${outcome}`);
  }

  supersede(originalId: string, newDecision: DecisionEntry): void {
    const original = this.entries.find(e => e.id === originalId);
    if (!original) {
      throw new Error(`Decision ${originalId} not found`);
    }

    original.status = 'superseded';
    original.supersededBy = newDecision.id;
    
    console.log(`Decision ${originalId} superseded by ${newDecision.id}`);
  }

  reverse(decisionId: string, reversalReason: string, decisionMaker: string): DecisionEntry {
    const original = this.entries.find(e => e.id === decisionId);
    if (!original) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    original.status = 'reversed';

    // Create reversal entry
    const reversal = this.recordDecision(
      `Reversal of ${original.title}`,
      `Reverse decision ${decisionId}`,
      reversalReason,
      decisionMaker,
      {
        tags: [...original.tags, 'reversal'],
        context: `Reverses decision ${decisionId}: ${original.decision}`
      }
    );

    original.supersededBy = reversal.id;
    return reversal;
  }

  query(filters: DecisionQuery = {}): DecisionEntry[] {
    let results = [...this.entries];

    // Filter by tags
    if (filters.tags && filters.tags.length > 0) {
      results = results.filter(entry =>
        filters.tags!.some(tag => entry.tags.includes(tag))
      );
    }

    // Filter by decision maker
    if (filters.decisionMaker) {
      results = results.filter(entry =>
        entry.decisionMaker === filters.decisionMaker
      );
    }

    // Filter by stakeholder
    if (filters.stakeholder) {
      results = results.filter(entry =>
        entry.stakeholders.includes(filters.stakeholder!)
      );
    }

    // Filter by status
    if (filters.status) {
      results = results.filter(entry => entry.status === filters.status);
    }

    // Filter by date range
    if (filters.dateRange) {
      results = results.filter(entry =>
        entry.timestamp >= filters.dateRange!.start &&
        entry.timestamp <= filters.dateRange!.end
      );
    }

    // Filter by search text
    if (filters.searchText) {
      const searchLower = filters.searchText.toLowerCase();
      results = results.filter(entry =>
        entry.title.toLowerCase().includes(searchLower) ||
        entry.decision.toLowerCase().includes(searchLower) ||
        entry.rationale.toLowerCase().includes(searchLower)
      );
    }

    // Sort by timestamp (newest first)
    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getDecision(id: string): DecisionEntry | null {
    return this.entries.find(entry => entry.id === id) || null;
  }

  getDecisionHistory(id: string, visited: Set<string> = new Set()): DecisionEntry[] {
    // Prevent infinite recursion
    if (visited.has(id)) {
      return [];
    }
    visited.add(id);

    const decision = this.getDecision(id);
    if (!decision) return [];

    const history: DecisionEntry[] = [decision];

    // Find what this decision superseded
    const superseded = this.entries.find(entry => entry.supersededBy === id);
    if (superseded && !visited.has(superseded.id)) {
      history.unshift(...this.getDecisionHistory(superseded.id, visited));
    }

    // Find what superseded this decision
    if (decision.supersededBy && !visited.has(decision.supersededBy)) {
      const superseder = this.getDecision(decision.supersededBy);
      if (superseder) {
        history.push(...this.getDecisionHistory(superseder.id, visited));
      }
    }

    return history;
  }

  generateReport(): string {
    const activeDecisions = this.query({ status: 'active' });
    const reversedDecisions = this.query({ status: 'reversed' });
    const supersededDecisions = this.query({ status: 'superseded' });

    const report = `
Decision Ledger Report
=====================
Generated: ${new Date().toISOString()}

Summary:
- Active decisions: ${activeDecisions.length}
- Reversed decisions: ${reversedDecisions.length}
- Superseded decisions: ${supersededDecisions.length}
- Total decisions: ${this.entries.length}

Active Decisions:
${activeDecisions.map(d => `- ${d.id}: ${d.title} (${d.decisionMaker})`).join('\n')}

Recent Activity:
${this.entries.slice(-5).map(d => `- ${d.timestamp.toISOString().split('T')[0]} ${d.id}: ${d.title}`).join('\n')}
`;

    return report.trim();
  }

  exportDecisions(): DecisionEntry[] {
    return [...this.entries];
  }

  importDecisions(decisions: DecisionEntry[]): void {
    this.entries = [...decisions];
    // Update nextId to avoid conflicts
    const maxId = Math.max(
      ...this.entries
        .map(e => parseInt(e.id.replace('DEC-', '')))
        .filter(id => !isNaN(id)),
      0
    );
    this.nextId = maxId + 1;
  }

  clear(): void {
    this.entries = [];
    this.nextId = 1;
  }
}
