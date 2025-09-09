import { MemoryManager } from './memory-manager.js';

async function demo() {
  console.log('Structured Memory Demo');
  console.log('='.repeat(50));
  
  const memory = new MemoryManager({
    shortTermMaxEntries: 5,
    shortTermMaxTokens: 500,
    longTermRetentionThreshold: 7,
    summarizationThreshold: 5
  });

  // Simulate a conversation with memory management
  console.log('\n1. Adding conversation history:');
  
  memory.addMemory(
    "User wants to build a web application using React and TypeScript", 
    'conversation', 
    8
  );
  
  memory.addMemory(
    "User prefers functional components over class components", 
    'conversation', 
    6
  );
  
  memory.addMemory(
    "The application needs to handle user authentication", 
    'conversation', 
    9
  );
  
  memory.addMemory(
    "User mentioned they have experience with Node.js backend", 
    'conversation', 
    7
  );
  
  memory.addMemory(
    "Database should be PostgreSQL for this project", 
    'conversation', 
    8
  );

  console.log('Memory stats:', memory.getMemoryStats());

  // Add more entries to trigger memory management
  console.log('\n2. Adding more context (will trigger memory management):');
  
  memory.addMemory(
    "User asked about state management options", 
    'conversation', 
    5
  );
  
  memory.addMemory(
    "Recommended Redux Toolkit for complex state", 
    'instruction', 
    6
  );
  
  memory.addMemory(
    "User is working on an e-commerce platform", 
    'context', 
    9
  );
  
  memory.addMemory(
    "The weather is nice today", 
    'conversation', 
    2
  );

  console.log('Memory stats after overflow:', memory.getMemoryStats());

  // Demonstrate retrieval
  console.log('\n3. Retrieving relevant memories for React question:');
  const reactMemories = memory.retrieveRelevant({
    keywords: ['react', 'web', 'application'],
    minImportance: 6,
    limit: 3
  });
  
  reactMemories.forEach(mem => {
    console.log(`- [${mem.category}] ${mem.content} (importance: ${mem.importance})`);
  });

  // Build context prompt
  console.log('\n4. Building context prompt for AI:');
  const contextPrompt = memory.buildContextPrompt({
    keywords: ['react', 'typescript', 'authentication'],
    categories: ['conversation', 'context'],
    minImportance: 6
  }, 300);
  
  console.log('Context prompt:');
  console.log('-'.repeat(30));
  console.log(contextPrompt);
  console.log('-'.repeat(30));

  // Demonstrate category-specific retrieval
  console.log('\n5. Retrieving only high-importance conversation memories:');
  const importantConversation = memory.retrieveRelevant({
    categories: ['conversation'],
    minImportance: 7
  });
  
  importantConversation.forEach(mem => {
    console.log(`- ${mem.content} (${mem.importance})`);
  });

  // Add facts and demonstrate mixed retrieval
  console.log('\n6. Adding facts and demonstrating mixed retrieval:');
  
  memory.addMemory(
    "React 18 introduced concurrent features", 
    'fact', 
    8
  );
  
  memory.addMemory(
    "TypeScript provides better type safety than JavaScript", 
    'fact', 
    7
  );
  
  const mixedMemories = memory.retrieveRelevant({
    keywords: ['react', 'typescript'],
    limit: 5
  });
  
  console.log('Mixed retrieval results:');
  mixedMemories.forEach(mem => {
    console.log(`- [${mem.category}] ${mem.content}`);
  });

  // Final memory stats
  console.log('\n7. Final memory statistics:');
  console.log(memory.getMemoryStats());
  
  console.log('\nDemo shows how structured memory:');
  console.log('• Keeps short-term memory lean and focused');
  console.log('• Moves important memories to long-term storage');
  console.log('• Enables targeted retrieval by keywords and categories');
  console.log('• Builds efficient context prompts within token limits');
  console.log('• Maintains relevance while managing memory size');
}

demo().catch(console.error);
