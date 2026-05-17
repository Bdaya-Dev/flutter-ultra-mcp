// list_tests — enumerate Patrol tests under integration_test/ and
// patrol_test/, grouped by file. Lets the agent target a specific test
// without grepping the source itself.

import { z } from 'zod';
import { defineTool } from './types.js';
import { findFlutterProject, locateTestDirectories } from '../runtime/project.js';
import { discoverTests } from '../util/test-discovery.js';

export const listTestsTool = defineTool({
  name: 'list_tests',
  description:
    'Enumerate Patrol tests in integration_test/ and patrol_test/, grouped by file. Returns [{file, testNames[], tags[]}] so the agent can target individual tests without parsing source.',
  inputSchema: z.object({
    projectRoot: z
      .string()
      .min(1)
      .describe('Absolute path to the Flutter project root (contains pubspec.yaml).'),
  }),
  async handler(input) {
    const project = findFlutterProject(input.projectRoot);
    const dirs = locateTestDirectories(project);
    if (dirs.length === 0) {
      return {
        project: project.root,
        packageName: project.packageName,
        directoriesScanned: [],
        tests: [],
      };
    }
    const tests = await discoverTests(project.root, dirs);
    return {
      project: project.root,
      packageName: project.packageName,
      directoriesScanned: dirs,
      tests,
    };
  },
});
