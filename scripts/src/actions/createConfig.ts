import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import ora from 'ora';
import yaml from 'js-yaml';
import { openai, ReasoningEffort, Verbosity } from '../lib/client';
import { ActionContext } from '../lib/action';

interface Config {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  sourceFiles: string[];
}

export default async function createConfig(context: ActionContext): Promise<ActionContext> {
  const createConfigSpinner = ora('Creating pattern.yml configuration').start();
  
  // Extract tags and category from the README content using AI
  const [tags, category] = await Promise.all([
    extractTags(context.readme),
    extractCategory(context.readme)
  ]);
  
  // Define source files based on the pattern structure
  const sourceFiles = [
    'README.md',
    'user-story.md',
    'examples/ts/main.ts',
    'examples/ts/main.test.ts',
    'examples/ts/README.md',
    'examples/py/main.py',
    'examples/py/test_main.py',
    'examples/py/README.md'
  ];
  
  const config: Config = {
    id: context.slug,
    name: context.name,
    description: context.description,
    category: category,
    tags: tags,
    sourceFiles: sourceFiles
  };
  
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 80,
    noRefs: true
  });
  
  const configPath = path.join(context.path, 'pattern.yml');
  fs.writeFileSync(configPath, yamlContent);
  
  createConfigSpinner.succeed(`Successfully created configuration: ${configPath}`);
  return {...context, configPath, config };
}

async function extractTags(readmeContent: string): Promise<string[]> {
  const prompt = `Analyze the following AI design pattern documentation and extract 3-5 relevant tags that would help categorize this pattern. 

Return only a JSON array of tag strings, nothing else.

Documentation:
${readmeContent}`;

  try {
    const TagSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["tags"],
    };
      
    const completion = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      parameters: {
        verbosity: Verbosity.LOW,
        reasoning_effort: ReasoningEffort.LOW,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "TagSchema",
          schema: TagSchema,
        },
      },
    });

    console.log(completion.output_parsed);
    
    return completion.output_parsed.tags || [];
  } catch (error) {
    console.warn('Failed to extract tags, using defaults:', (error as Error).message);
    return ['ai-pattern', 'design-pattern', 'implementation'];
  }
}

async function extractCategory(readmeContent: string): Promise<string> {
  const prompt = `Analyze the following AI design pattern documentation and determine the primary category this pattern belongs to.

Choose from these categories:
- Architecture: Patterns that define system structure and organization
- Behavioral: Patterns that define communication and interaction between components
- Creational: Patterns that handle object creation and instantiation
- Operational: Patterns that manage runtime behavior and execution
- Governance: Patterns that handle decision-making and control mechanisms
- Security: Patterns that address safety and access control
- Performance: Patterns that optimize efficiency and resource usage
- Integration: Patterns that handle external system connections

Return only a JSON object with the category, nothing else.

Documentation:
${readmeContent}`;

  try {
    const CategorySchema = {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["Architecture", "Behavioral", "Creational", "Operational", "Governance", "Security", "Performance", "Integration"]
        },
      },
      required: ["category"],
    };
      
    const completion = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      parameters: {
        verbosity: Verbosity.LOW,
        reasoning_effort: ReasoningEffort.LOW,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "CategorySchema",
          schema: CategorySchema,
        },
      },
    });

    console.log(completion.output_parsed);
    
    return completion.output_parsed.category || 'Operational';
  } catch (error) {
    console.warn('Failed to extract category, using default:', (error as Error).message);
    return 'Operational';
  }
}
