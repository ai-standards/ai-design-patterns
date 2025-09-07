#!/usr/bin/env node


import 'dotenv/config';
import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, stat } from 'fs/promises';

import { generatePattern } from './lib/generate-pattern.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .command('action <actionPath>')
  .description('Run an action or directory of actions')
  .action(async (actionPath, outputPath) => {
    const context = {
      output: outputPath || process.cwd()
    }
  });

program.parse(process.argv);
