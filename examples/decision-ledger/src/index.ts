import { DecisionLedger } from './decision-ledger.js';

async function demo() {
  console.log('Decision Ledger Demo');
  console.log('='.repeat(50));
  
  const ledger = new DecisionLedger();

  // Example 1: Record a major architectural decision
  console.log('\n1. Recording architectural decisions:');
  
  const modelDecision = ledger.recordDecision(
    'Choose LLM Provider',
    'Use OpenAI GPT-4 for our AI features',
    'GPT-4 provides the best balance of capability, reliability, and cost for our use case. The API is stable and well-documented.',
    'alice@company.com',
    {
      alternatives: [
        {
          option: 'Anthropic Claude',
          pros: ['Good safety features', 'Long context window'],
          cons: ['Higher cost', 'Less mature API'],
          whyRejected: 'Cost concerns and API stability questions'
        },
        {
          option: 'Open-source model (Llama)',
          pros: ['No API costs', 'Full control'],
          cons: ['Infrastructure complexity', 'Lower quality'],
          whyRejected: 'Team lacks ML infrastructure expertise'
        }
      ],
      stakeholders: ['alice@company.com', 'bob@company.com', 'charlie@company.com'],
      context: 'Building customer support chatbot for Q2 launch',
      tags: ['architecture', 'llm', 'vendor-selection']
    }
  );

  // Example 2: Record a process decision
  const processDecision = ledger.recordDecision(
    'AI Model Evaluation Process',
    'Implement A/B testing for all model changes',
    'A/B testing provides objective data on model performance changes. We will test with 10% of traffic for 1 week before full rollout.',
    'bob@company.com',
    {
      alternatives: [
        {
          option: 'Shadow testing only',
          pros: ['No user impact', 'Safe'],
          cons: ['No real user feedback', 'Slower iteration'],
          whyRejected: 'Need real user data to make good decisions'
        }
      ],
      stakeholders: ['bob@company.com', 'alice@company.com'],
      tags: ['process', 'testing', 'deployment']
    }
  );

  // Example 3: Record outcome of a decision
  console.log('\n2. Recording decision outcomes:');
  
  ledger.updateOutcome(
    modelDecision.id,
    'GPT-4 integration successful. 95% user satisfaction, 40% reduction in support tickets.'
  );

  // Example 4: Query decisions by different criteria
  console.log('\n3. Querying decisions:');
  
  console.log('All architecture decisions:');
  const archDecisions = ledger.query({ tags: ['architecture'] });
  archDecisions.forEach(d => {
    console.log(`- ${d.id}: ${d.title} by ${d.decisionMaker}`);
  });

  console.log('\nDecisions by Alice:');
  const aliceDecisions = ledger.query({ decisionMaker: 'alice@company.com' });
  aliceDecisions.forEach(d => {
    console.log(`- ${d.id}: ${d.title}`);
  });

  // Example 5: Demonstrate decision reversal
  console.log('\n4. Reversing a decision:');
  
  const deploymentDecision = ledger.recordDecision(
    'Auto-deployment to Production',
    'Enable automatic deployment for AI model updates',
    'Speed up iteration cycles by removing manual approval step',
    'charlie@company.com',
    {
      tags: ['deployment', 'automation'],
      stakeholders: ['charlie@company.com', 'alice@company.com']
    }
  );

  // Later, reverse the decision due to issues
  const reversal = ledger.reverse(
    deploymentDecision.id,
    'Auto-deployment caused production issues. Manual approval provides necessary safety check.',
    'alice@company.com'
  );

  console.log(`Original decision ${deploymentDecision.id} status: ${ledger.getDecision(deploymentDecision.id)?.status}`);
  console.log(`Reversal decision: ${reversal.id}`);

  // Example 6: Show decision history
  console.log('\n5. Decision history and relationships:');
  
  const history = ledger.getDecisionHistory(deploymentDecision.id);
  console.log(`Decision chain for ${deploymentDecision.id}:`);
  history.forEach((d, i) => {
    console.log(`  ${i + 1}. ${d.id}: ${d.title} (${d.status})`);
  });

  // Example 7: Search decisions
  console.log('\n6. Searching decisions:');
  
  const searchResults = ledger.query({ searchText: 'deployment' });
  console.log('Decisions mentioning "deployment":');
  searchResults.forEach(d => {
    console.log(`- ${d.id}: ${d.title}`);
  });

  // Example 8: Generate report
  console.log('\n7. Decision ledger report:');
  console.log(ledger.generateReport());

  // Example 9: Show specific decision details
  console.log('\n8. Detailed decision view:');
  const decision = ledger.getDecision(modelDecision.id);
  if (decision) {
    console.log(`
Decision: ${decision.id}
Title: ${decision.title}
Made by: ${decision.decisionMaker}
Date: ${decision.timestamp.toISOString().split('T')[0]}
Status: ${decision.status}

Decision: ${decision.decision}

Rationale: ${decision.rationale}

Alternatives considered:
${decision.alternatives.map(alt => 
  `- ${alt.option}: ${alt.whyRejected || 'Not specified why rejected'}`
).join('\n')}

Stakeholders: ${decision.stakeholders.join(', ')}
Tags: ${decision.tags.join(', ')}
${decision.outcome ? `\nOutcome: ${decision.outcome}` : ''}
    `);
  }

  console.log('\nDemo shows how Decision Ledger:');
  console.log('• Captures decisions with full context and alternatives');
  console.log('• Prevents re-litigation by preserving rationale');
  console.log('• Enables querying and searching past decisions');
  console.log('• Tracks decision outcomes and reversals');
  console.log('• Provides institutional memory for teams');
}

demo().catch(console.error);
