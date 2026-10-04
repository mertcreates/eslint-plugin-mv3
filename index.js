import noExecuteScriptClosureRule from './rules/no-execute-script-closure.js';

import argumentLoss from './rules/no-execute-script-argument-loss.js';
import validOptions from './rules/valid-execute-script-options.js';
import noMainWorld from './rules/no-main-world.js';

export const rules = {
  'no-execute-script-closure': noExecuteScriptClosureRule,
  'valid-execute-script-options': validOptions,
  'no-execute-script-argument-loss': argumentLoss,
  'no-main-world': noMainWorld,
};

const plugin = {
  meta: {
    name: '@mertcreates/eslint-plugin-mv3',
  },
  rules,
};

plugin.configs = {
  recommended: {
    plugins: {
      '@mertcreates/mv3': plugin,
    },
    rules: {
      '@mertcreates/mv3/no-execute-script-closure': 'error',
    },
  },
};

export default plugin;
