const fs = require('fs');
const path = require('path');

// Base package.json template for all patterns
const createPackageJson = (patternName, description, tags) => ({
  name: `@ai-design-patterns/${patternName}`,
  version: "1.0.0",
  description,
  main: "dist/index.js",
  types: "dist/index.d.ts",
  scripts: {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  keywords: tags,
  author: "flyman",
  license: "MIT",
  docs: {
    "index": "README.md"
  },
  devDependencies: {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0"
  }
});

// TypeScript config template
const createTsConfig = () => ({
  compilerOptions: {
    target: "ES2020",
    module: "ESNext",
    moduleResolution: "node",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    declaration: true,
    outDir: "./dist",
    rootDir: "./src",
    resolveJsonModule: true
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", "**/*.test.ts"]
});

// Vitest config template
const createVitestConfig = () => ({
  test: {
    globals: true,
    environment: "node"
  }
});

// Placeholder index.ts template
const createIndexTs = (patternName) => `// ${patternName} - End to End Example
// This is a placeholder for the complete implementation

export function example() {
  return "Hello from ${patternName}!";
}

// Add your pattern implementation here
`;

// Placeholder test file template
const createTestFile = (patternName) => `import { describe, it, expect } from 'vitest';
import { example } from './index';

describe('${patternName}', () => {
  it('should work', () => {
    expect(example()).toBe('Hello from ${patternName}!');
  });
});
`;

// Main refactoring function
async function refactorPatterns() {
  const patternsDir = path.join(__dirname, '..', 'patterns');
  const patterns = fs.readdirSync(patternsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && /^\d{4}-/.test(dirent.name))
    .map(dirent => dirent.name)
    .sort();

  console.log(`Found ${patterns.length} patterns to refactor:`);
  patterns.forEach(p => console.log(`  - ${p}`));

  for (const pattern of patterns) {
    const patternPath = path.join(patternsDir, pattern);
    const patternYmlPath = path.join(patternPath, 'pattern.yml');
    
    if (!fs.existsSync(patternYmlPath)) {
      console.log(`Skipping ${pattern}: no pattern.yml found`);
      continue;
    }

    console.log(`\nRefactoring ${pattern}...`);

    try {
      // Read pattern.yml
      const ymlContent = fs.readFileSync(patternYmlPath, 'utf8');
      
      // Extract metadata (simple parsing for now)
      const titleMatch = ymlContent.match(/title:\s*"([^"]+)"/);
      const descMatch = ymlContent.match(/description:\s*"([^"]+)"/);
      const tagsMatch = ymlContent.match(/tags:\s*\n\s*-\s*(.+)/s);
      
      const title = titleMatch ? titleMatch[1] : pattern;
      const description = descMatch ? descMatch[1] : `AI Design Pattern: ${pattern}`;
      const tags = tagsMatch ? tagsMatch[1].split('\n').map(t => t.trim().replace('- ', '')).filter(Boolean) : ['ai-design-patterns'];

      // Create package.json
      const packageJson = createPackageJson(pattern, description, tags);
      fs.writeFileSync(
        path.join(patternPath, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create tsconfig.json
      const tsConfig = createTsConfig();
      fs.writeFileSync(
        path.join(patternPath, 'tsconfig.json'),
        JSON.stringify(tsConfig, null, 2)
      );

      // Create vitest.config.ts
      const vitestConfig = createVitestConfig();
      fs.writeFileSync(
        path.join(patternPath, 'vitest.config.ts'),
        `export default ${JSON.stringify(vitestConfig, null, 2)};`
      );

      // Check if example directory exists and move it to src
      const exampleDir = path.join(patternPath, 'example');
      const srcDir = path.join(patternPath, 'src');
      
      if (fs.existsSync(exampleDir)) {
        // Move existing example to src
        if (fs.existsSync(srcDir)) {
          fs.rmSync(srcDir, { recursive: true, force: true });
        }
        fs.renameSync(exampleDir, srcDir);
        console.log(`  ✓ Moved existing example/ to src/`);
      } else {
        // Create new src directory and placeholder files
        if (!fs.existsSync(srcDir)) {
          fs.mkdirSync(srcDir, { recursive: true });
        }

        const indexTs = createIndexTs(title);
        fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);

        // Create test file
        const testFile = createTestFile(title);
        fs.writeFileSync(path.join(srcDir, `${pattern}.test.ts`), testFile);
        console.log(`  ✓ Created placeholder src/index.ts and test file`);
      }

      // Create .gitignore
      const gitignore = `node_modules/
dist/
coverage/
*.log
.DS_Store
`;
      fs.writeFileSync(path.join(patternPath, '.gitignore'), gitignore);

      // Create README.md if it doesn't exist
      const readmePath = path.join(patternPath, 'README.md');
      if (!fs.existsSync(readmePath)) {
        const readme = `# ${title}

${description}

## Installation

\`\`\`bash
npm install
\`\`\`

## Development

\`\`\`bash
npm run dev
npm test
\`\`\`

## Build

\`\`\`bash
npm run build
\`\`\`
`;
        fs.writeFileSync(readmePath, readme);
      }

      // Clean up: delete pattern.yml after conversion
      fs.unlinkSync(patternYmlPath);
      console.log(`  ✓ Deleted pattern.yml`);

      console.log(`  ✓ Created package.json`);
      console.log(`  ✓ Created tsconfig.json`);
      console.log(`  ✓ Created vitest.config.ts`);
      console.log(`  ✓ Created .gitignore`);
      console.log(`  ✓ Updated README.md`);

    } catch (error) {
      console.error(`  ✗ Error refactoring ${pattern}:`, error.message);
    }
  }

  console.log('\nRefactoring complete!');
  console.log('\nNext steps:');
  console.log('1. Run "npm install" in each pattern directory');
  console.log('2. Run "npm test" to verify the setup');
  console.log('3. Implement the actual pattern logic in src/index.ts');
}

// Run the refactoring
if (require.main === module) {
  refactorPatterns().catch(console.error);
}

module.exports = { refactorPatterns };
