import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import { openai, Verbosity, ReasoningEffort } from '../lib/client';
import { ActionContext } from '../lib/action';

export default async function createTsUnitTest(context: ActionContext): Promise<ActionContext> {
  const createTsUnitTestSpinner = ora('Generating TypeScript unit tests').start();
  const prompt = `Create unit tests for the TypeScript example of the AI design pattern "${context.name}".

Pattern description: ${context.description}

Create comprehensive unit tests that cover:
- All public functions and methods
- Edge cases and error conditions
- Different input scenarios
- Mock data and test utilities

Use Vitest as the testing framework and follow testing best practices.`;

  try {
    const completion = await openai.responses.create({
      model: "gpt-5",
      input: prompt,
      parameters: {
        verbosity: Verbosity.HIGH,
        reasoning_effort: ReasoningEffort.HIGH,
      }
    });

    const tsTestContent = completion.output;
    const tsTestPath = path.join(context.path, 'examples/ts/main.test.ts');
    
    // Ensure the examples/ts directory exists
    fs.mkdirSync(path.dirname(tsTestPath), { recursive: true });
    fs.writeFileSync(tsTestPath, tsTestContent);

    createTsUnitTestSpinner.succeed(`Successfully generated file: ${tsTestPath}`);
    return {...context, tsTest: tsTestContent, tsTestPath: tsTestPath};
  } catch (error) {
    createTsUnitTestSpinner.fail(`Failed to generate TypeScript unit tests: ${(error as Error).message}`);
    throw error;
  }
}
