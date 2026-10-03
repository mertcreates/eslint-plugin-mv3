import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import plugin from '@mertcreates/eslint-plugin-mv3';

const ruleId = '@mertcreates/mv3/no-execute-script-closure';
const linter = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [plugin.configs.recommended],
});

const [valid, invalid] = await Promise.all([
  linter.lintText('chrome.scripting.executeScript({ func: () => Date.now() });', { filePath: 'valid.js' }),
  linter.lintText('const OUTER = 1; chrome.scripting.executeScript({ func: () => OUTER });', { filePath: 'invalid.js' }),
]);

assert.deepEqual(valid[0].messages, []);
assert.equal(invalid[0].messages.length, 1);
assert.equal(invalid[0].messages[0].ruleId, ruleId);
assert.equal(invalid[0].messages[0].messageId, 'closureCapture');
console.log(`Recommended config smoke passed with ESLint ${ESLint.version}.`);
