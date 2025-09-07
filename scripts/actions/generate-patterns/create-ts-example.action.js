import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import { openai, Verbosity, ReasoningEffort } from '../../lib/client.js';

export default async function createTsExample(context) {
    const createTsExampleSpinner = ora('Generating TypeScript example').start();
    const prompt = `Create a TypeScript example for the AI design pattern "${context.name}".

Pattern description: ${context.description}

Create a complete, working TypeScript example that demonstrates this pattern. Include:
- Proper imports and type definitions
- A clear example class/function that implements the pattern
- Usage example showing how to use it
- Comments explaining key parts of the implementation

The code should be production-ready and follow TypeScript best practices.`;

    try {
        const completion = await openai.responses.create({
            model: "gpt-5",
            input: prompt,
            parameters: {
                verbosity: Verbosity.HIGH,
                reasoning_effort: ReasoningEffort.HIGH,
            }
        });

        const tsExampleContent = completion.output;
        const tsExamplePath = path.join(context.path, 'examples/ts/main.ts');
        
        // Ensure the examples/ts directory exists
        fs.mkdirSync(path.dirname(tsExamplePath), { recursive: true });
        fs.writeFileSync(tsExamplePath, tsExampleContent);

        createTsExampleSpinner.succeed(`Successfully generated file: ${tsExamplePath}`);
        return {...context, tsExample: tsExampleContent, tsExamplePath: tsExamplePath};
    } catch (error) {
        createTsExampleSpinner.fail(`Failed to generate TypeScript example: ${error.message}`);
        throw error;
    }
}
