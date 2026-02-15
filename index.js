import noExecuteScriptClosureRule from './rules/no-execute-script-closure.js';

export const rules = {
  'no-execute-script-closure': noExecuteScriptClosureRule,
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
