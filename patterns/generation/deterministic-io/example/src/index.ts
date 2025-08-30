import { DeterministicGenerator } from './deterministic-generator.js';
import { TaskAnalysisSchema, ProductRecommendationSchema, SentimentAnalysisSchema } from './schemas.js';

async function demo() {
  console.log('Deterministic IO Demo\n');
  
  const generator = new DeterministicGenerator();
  
  // Example 1: Task Analysis
  console.log('1. Task Analysis:');
  const taskResult = await generator.generate(
    'Analyze this task: "Implement user authentication system"',
    TaskAnalysisSchema,
    { maxRetries: 3, temperature: 0.1 }
  );
  
  if (taskResult.success) {
    console.log('Success!', taskResult.data);
    console.log(`Completed in ${taskResult.attempts} attempt(s)`);
  } else {
    console.log('Failed after', taskResult.attempts, 'attempts');
    console.log('Errors:', taskResult.errors);
  }
  
  // Example 2: Product Recommendation
  console.log('\n2. Product Recommendation:');
  const productResult = await generator.generate(
    'Recommend a product for: budget laptop under $800',
    ProductRecommendationSchema
  );
  
  if (productResult.success) {
    console.log('Success!', productResult.data);
  } else {
    console.log('Failed:', productResult.errors);
  }
  
  // Example 3: Sentiment Analysis
  console.log('\n3. Sentiment Analysis:');
  const sentimentResult = await generator.generate(
    'Analyze sentiment: "This product is absolutely fantastic! I love it."',
    SentimentAnalysisSchema
  );
  
  if (sentimentResult.success) {
    console.log('Success!', sentimentResult.data);
  } else {
    console.log('Failed:', sentimentResult.errors);
  }
  
  // Example 4: Demonstrate retry behavior
  console.log('\n4. Retry Behavior Demo (may show retries):');
  for (let i = 0; i < 3; i++) {
    const retryResult = await generator.generate(
      'Analyze this task: "Debug the payment system"',
      TaskAnalysisSchema,
      { maxRetries: 2 }
    );
    console.log(`Try ${i + 1}: ${retryResult.success ? 'Success' : 'Failed'} (${retryResult.attempts} attempts)`);
  }
}

demo().catch(console.error);
