import { ContextLedger } from './ledger.js';
import { AIGenerator } from './generator.js';

async function demo() {
  console.log('Context Ledger Demo\n');
  
  const ledger = new ContextLedger();
  const generator = new AIGenerator(ledger);
  
  // Generate with context logging
  const result1 = await generator.generateWithLedger(
    'session-123',
    'What is the capital of France?',
    'You are a helpful geography assistant.'
  );
  
  console.log('\nResult:', result1.output);
  
  // Generate another message in the same session
  const result2 = await generator.generateWithLedger(
    'session-123',
    'What about Germany?'
  );
  
  console.log('\nResult:', result2.output);
  
  // Show ledger contents
  console.log('\nComplete Ledger:');
  ledger.getAllEntries().forEach(entry => {
    console.log(`- ${entry.id}: ${'prompt' in entry ? 'Context' : 'Generation'}`);
  });
  
  // Demonstrate reproduction
  console.log('\nReproducing first context:');
  ledger.reproduceContext(result1.contextEntry.id);
}

// Run demo
demo().catch(console.error);
