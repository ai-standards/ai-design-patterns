import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import { openai, Verbosity, ReasoningEffort } from '../../lib/client.js';

export default async function createTsDocReadme(context) {
    const createTsDocReadmeSpinner = ora('Generating TypeScript documentation README').start();
    const prompt = `Create a README.md for the TypeScript example of the AI design pattern "${context.name}".

Pattern description: ${context.description}

Create documentation that includes:
- Overview of the example
- Setup and installation instructions
- How to run the example
- How to run the tests
- Key concepts demonstrated
- Dependencies and requirements

Write clear, concise documentation that helps developers understand and use the example.`;

    try {
        const completion = await openai.responses.create({
            model: "gpt-5",
            input: prompt,
            parameters: {
                verbosity: Verbosity.MEDIUM,
                reasoning_effort: ReasoningEffort.MEDIUM,
            }
        });

        const tsDocContent = completion.output;
        const tsDocPath = path.join(context.path, 'examples/ts/README.md');
        
        // Ensure the examples/ts directory exists
        fs.mkdirSync(path.dirname(tsDocPath), { recursive: true });
        fs.writeFileSync(tsDocPath, tsDocContent);

        createTsDocReadmeSpinner.succeed(`Successfully generated file: ${tsDocPath}`);
        return {...context, tsDoc: tsDocContent, tsDocPath: tsDocPath};
    } catch (error) {
        createTsDocReadmeSpinner.fail(`Failed to generate TypeScript documentation: ${error.message}`);
        throw error;
    }
}
