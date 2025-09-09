import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import { openai, Verbosity, ReasoningEffort } from '../lib/client';
import { ActionContext } from '../lib/action';

export default async function createUserStory(context: ActionContext): Promise<ActionContext> {
  const createUserStorySpinner = ora('Generating user-story.md').start();
  const prompt = `Create a user story for the AI design pattern "${context.name}".

Pattern description: ${context.description}

The user story should follow this format:
As a [type of user/developer]
I want to [achieve a specific goal]
So that [benefit/value]

Include:
- A clear problem statement
- The solution approach
- Expected outcomes
- Any constraints or considerations

Write in a clear, narrative style that explains the user's perspective.`;

  try {
    const completion = await openai.responses.create({
      model: "gpt-5",
      input: prompt,
      parameters: {
        verbosity: Verbosity.MEDIUM,
        reasoning_effort: ReasoningEffort.MEDIUM,
      }
    });

    const userStoryContent = completion.output;
    const userStoryPath = path.join(context.path, 'user-story.md');
    fs.writeFileSync(userStoryPath, userStoryContent);

    createUserStorySpinner.succeed(`Successfully generated file: ${userStoryPath}`);
    return {...context, userStory: userStoryContent, userStoryPath: userStoryPath};
  } catch (error) {
    createUserStorySpinner.fail(`Failed to generate user story: ${(error as Error).message}`);
    throw error;
  }
}
