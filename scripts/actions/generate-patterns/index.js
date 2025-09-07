#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { createAction } from '../../lib/action.js';
import createDir from './create-dir.action.js';
import createReadme from './create-readme.action.js';
import createUserStory from './create-user-story.action.js';
import createTsExample from './create-ts-example.action.js';
import createTsUnitTest from './create-ts-unit-test.action.js';
import createTsDocReadme from './create-ts-doc-readme.action.js';
import createPythonExample from './create-python-example.action.js';
import createConfig from './create-config.action.js';

const action = createAction(
    createDir,
    createReadme,
    createUserStory,
    createTsExample,
    createTsUnitTest,
    createTsDocReadme,
    createPythonExample,
    createConfig
);

const patterns = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'ai_design_patterns_index.json'), 'utf8'));

const context = {
    output: path.resolve('../../../patterns/v2'),
    model: 'gpt-5-mini'
};

for (const pattern of patterns.patterns) {
    await action.run({
        ...context,
        ...pattern
    });
}

