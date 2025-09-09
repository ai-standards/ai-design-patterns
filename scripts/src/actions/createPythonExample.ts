import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import { openai, Verbosity, ReasoningEffort } from '../lib/client';
import { ActionContext } from '../lib/action';

export default async function createPythonExample(context: ActionContext): Promise<ActionContext> {
  const createPythonExampleSpinner = ora('Generating Python example').start();
  const prompt = `Create a Python example for the AI design pattern "${context.name}".

Pattern description: ${context.description}

Create a complete, working Python example that demonstrates this pattern. Include:
- Proper imports and type hints
- A clear example class/function that implements the pattern
- Usage example showing how to use it
- Comments explaining key parts of the implementation
- Requirements.txt with necessary dependencies

The code should be production-ready and follow Python best practices.`;

  try {
    const completion = await openai.responses.create({
      model: "gpt-5",
      input: prompt,
      parameters: {
        verbosity: Verbosity.HIGH,
        reasoning_effort: ReasoningEffort.HIGH,
      }
    });

    const pythonExampleContent = completion.output;
    const pythonExamplePath = path.join(context.path, 'examples/py/main.py');
    
    // Ensure the examples/py directory exists
    fs.mkdirSync(path.dirname(pythonExamplePath), { recursive: true });
    fs.writeFileSync(pythonExamplePath, pythonExampleContent);

    createPythonExampleSpinner.succeed(`Successfully generated file: ${pythonExamplePath}`);
    return {...context, pythonExample: pythonExampleContent, pythonExamplePath: pythonExamplePath};
  } catch (error) {
    createPythonExampleSpinner.fail(`Failed to generate Python example: ${(error as Error).message}`);
    throw error;
  }
}
