import fs from 'fs';
import path from 'path';
import ora from 'ora';
import { ActionContext } from '../lib/action';

export default async function createDir(context: ActionContext): Promise<ActionContext> {
  // Use the output path provided in context
  const outputPath = context.output;
  
  if (!outputPath) {
    throw new Error('Output path not provided in context');
  }

  // Count existing patterns and determine next number
  const patternsDir = outputPath;
  const patternFolders = fs.readdirSync(patternsDir).filter(f => fs.statSync(path.join(patternsDir, f)).isDirectory() && /^\d{4}-/.test(f));
  const nextNum = (patternFolders.length + 1).toString().padStart(4, '0');

  // Slugify the name for folder
  const slug = context.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const fullSlug = `${nextNum}-${slug}`;
  const patternDir = path.join(patternsDir, fullSlug);

  if (fs.existsSync(patternDir)) {
    throw new Error(`Pattern directory '${fullSlug}' already exists.`);
  }

  fs.mkdirSync(patternDir, { recursive: true });
  return {...context, path: patternDir, slug: fullSlug };
}
