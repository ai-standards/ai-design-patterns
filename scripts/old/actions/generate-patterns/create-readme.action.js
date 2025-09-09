import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import { openai, Verbosity, ReasoningEffort } from '../../lib/client.js';

export default async function createReadme(context) {
    const createReadmeSpinner = ora('Generating README.md').start();
    const prompt = `As the documentation writer, create a README.md for the AI design pattern "${context.name}".

Pattern description: ${context.description}

The README should include:
- A clear introduction to the pattern and its purpose
- When and why to use it
- Key benefits and tradeoffs
- Example use cases
- Any important implementation notes

For each section, write at least one readable paragraph before any list or bullet points.
Use bullets only to highlight key details, not as a replacement for narrative explanation.
Write in a formal yet approachable, first-person style.`;

    try {
        const completion = await openai.responses.create({
            model: "gpt-5",
            input: prompt,
            parameters: {
                verbosity: Verbosity.HIGH,
                reasoning_effort: ReasoningEffort.MEDIUM,
            }
        });

        const readmeContent = completion.output;
        const readmePath = path.join(context.path, 'README.md');
        fs.writeFileSync(readmePath, readmeContent);

        createReadmeSpinner.succeed(`Successfully generated file: ${readmePath}`);
        return {...context, readme: readmeContent, readmePath: readmePath};
    } catch (error) {
        createReadmeSpinner.fail(`Failed to generate README: ${error.message}`);
        throw error;
    }
}
