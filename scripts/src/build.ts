#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { createAction } from './lib/action';
import createDir from './actions/createDir';
import createReadme from './actions/createReadme';
import createUserStory from './actions/createUserStory';
import createTsExample from './actions/createTsExample';
import createTsUnitTest from './actions/createTsUnitTest';
import createTsDocReadme from './actions/createTsDocReadme';
import createPythonExample from './actions/createPythonExample';
import createConfig from './actions/createConfig';

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

const patterns = JSON.parse(fs.readFileSync(path.join(process.cwd(), '../index.json'), 'utf8'));

const context = {
  output: path.resolve('../../../patterns'),
  model: 'gpt-5-mini'
};

for (const pattern of patterns) {
  await action.run({
    ...context,
    ...pattern
  });
}