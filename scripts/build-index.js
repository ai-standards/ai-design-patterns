const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const yaml = require('js-yaml');

function getExampleFiles(examplePath) {
  const files = [];
  
  function walkDir(dir, basePath = '') {
    const entries = fs.readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const relativePath = basePath ? path.join(basePath, entry) : entry;
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Skip node_modules and other common directories
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry)) {
          walkDir(fullPath, relativePath);
        }
      } else if (stat.isFile()) {
        // Only include source files
        const ext = path.extname(entry);
        if (['.ts', '.js', '.json', '.md', '.yml', '.yaml'].includes(ext)) {
          files.push(relativePath);
        }
      }
    }
  }
  
  walkDir(examplePath);
  return files.sort();
}

function buildIndex() {
  const patterns = [];
  const sections = new Map();
  const tagCounts = new Map();

  // Get all pattern.yml files
  const patternFiles = glob.sync('patterns/*/pattern.yml');
  console.log(`Found ${patternFiles.length} pattern files`);

  for (const filePath of patternFiles) {
    const dir = path.basename(path.dirname(filePath));
    const patternYml = yaml.load(fs.readFileSync(filePath, 'utf8'));
    
    // Check if example exists and get source files
    const examplePath = path.join(path.dirname(filePath), 'example');
    const hasExample = fs.existsSync(examplePath) && 
      fs.statSync(examplePath).isDirectory() &&
      fs.readdirSync(examplePath).length > 0;
    
    const exampleFiles = hasExample ? getExampleFiles(examplePath) : [];

    // Extract section from tags (first tag should be section)
    const section = patternYml.tags[0];

    // Build pattern object
    const pattern = {
      id: dir,
      title: patternYml.title,
      section: section,
      description: patternYml.description,
      hasExample: hasExample,
      exampleFiles: exampleFiles,
      author: patternYml.author,
      createdAt: patternYml.createdAt,
      tags: patternYml.tags
    };

    patterns.push(pattern);

    // Count sections
    if (!sections.has(section)) {
      sections.set(section, {
        id: section,
        title: getSectionTitle(section),
        description: getSectionDescription(section),
        patternCount: 0
      });
    }
    sections.get(section).patternCount++;

    // Count tags
    patternYml.tags.forEach(tag => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  }

  // Build sections array
  const sectionsArray = Array.from(sections.values()).sort((a, b) => {
    const order = ['generation', 'governance', 'architecture', 'operational', 'automation-strategies', 'anti-patterns'];
    return order.indexOf(a.id) - order.indexOf(b.id);
  });

  // Build tags array
  const tagsArray = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Build final index
  const index = {
    patterns,
    sections: sectionsArray,
    tags: tagsArray,
    metadata: {
      totalPatterns: patterns.length,
      totalSections: sectionsArray.length,
      patternsWithExamples: patterns.filter(p => p.hasExample).length,
      totalTags: tagsArray.length,
      lastUpdated: new Date().toISOString().split('T')[0],
      version: "1.0.0"
    }
  };

  // Write index.json
  const indexPath = path.join(__dirname, '..', 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  
  console.log(`✅ Built index.json with ${patterns.length} patterns`);
  console.log(`   Sections: ${sectionsArray.length}`);
  console.log(`   Tags: ${tagsArray.length}`);
  console.log(`   With examples: ${patterns.filter(p => p.hasExample).length}`);
}

function getSectionTitle(section) {
  const titles = {
    'generation': 'Generation Patterns',
    'governance': 'Governance Patterns',
    'architecture': 'Architecture Patterns',
    'operational': 'Operations Patterns',
    'automation-strategies': 'Automation Strategies',
    'anti-patterns': 'Anti-Patterns'
  };
  return titles[section] || section;
}

function getSectionDescription(section) {
  const descriptions = {
    'generation': 'How models produce and manage outputs. Turn raw model completions into reliable, evaluable, and useful building blocks.',
    'governance': 'How AI teams organize discovery and make decisions. Move forward when there is uncertainty, disagreement, or risk.',
    'architecture': 'How AI systems are structured. Organize agents, tools, and views so discovery doesn\'t collapse into chaos.',
    'operational': 'How AI systems are launched, monitored, and controlled in production. Run systems safely, reliably, and cost-effectively.',
    'automation-strategies': 'How agentic systems execute real work under constraints. Let agents act with the right permissions and oversight.',
    'anti-patterns': 'The dead ends. Approaches that feel fast or clever at first but collapse under real-world use.'
  };
  return descriptions[section] || '';
}

// Run the build
if (require.main === module) {
  buildIndex();
}

module.exports = { buildIndex };
