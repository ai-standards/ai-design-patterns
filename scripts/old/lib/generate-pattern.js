import * as inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import run from '../actions/generate-patterns/index.js';

export async function generatePattern() {
  // Load and analyze existing patterns
  const patternsIndexPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/ai_design_patterns_index.json');
  const patternsData = JSON.parse(fs.readFileSync(patternsIndexPath, 'utf8'));
  
  // Filter for incomplete patterns (those without a 'done' field or where done is false)
  const incompletePatterns = patternsData.patterns.filter(pattern => !pattern.done);
  
  let i = 0;
  if (incompletePatterns.length > 0) {
    if (i++ > 1) {
        throw new Error('doneish')
    }
    for (const pattern of incompletePatterns) {
        // Pass the pattern config to run
        await run(pattern);
    }
  }


}