import assert from 'node:assert/strict';
import { version as nodeVersion } from 'node:process';
import { ESLint } from 'eslint';
import plugin from '@mertcreates/eslint-plugin-mv3';

const Linter =
  Number(ESLint.version.split('.')[0]) === 8
    ? (await import('eslint/use-at-your-own-risk')).default.FlatESLint
    : ESLint;

const ruleId = '@mertcreates/mv3/no-execute-script-closure';
const linter = new Linter({
  overrideConfigFile: true,
  overrideConfig: [plugin.configs.recommended],
});

const [valid, invalid] = await Promise.all([
  linter.lintText('chrome.scripting.executeScript({ func: () => Date.now() });', { filePath: 'valid.js' }),
  linter.lintText('const OUTER = 1; chrome.scripting.executeScript({ func: () => OUTER });', {
    filePath: 'invalid.js',
  }),
]);

assert.deepEqual(valid[0].messages, []);
assert.equal(invalid[0].messages.length, 1);
assert.equal(invalid[0].messages[0].ruleId, ruleId);
assert.equal(invalid[0].messages[0].messageId, 'closureCapture');
console.log(`Recommended config smoke passed with ESLint ${ESLint.version} on Node ${nodeVersion}.`);

assert.deepEqual(Object.keys(plugin.configs.recommended.rules), [ruleId]);
const allRules = new Linter({
  overrideConfigFile: true,
  overrideConfig: [
    {
      plugins: { '@mertcreates/mv3': plugin },
      rules: Object.fromEntries(Object.keys(plugin.rules).map((name) => [`@mertcreates/mv3/${name}`, 'error'])),
    },
  ],
});
const [good] = await allRules.lintText(
  'chrome.scripting.executeScript({target:{tabId:1},func:(x)=>x,args:[{ok:true}]});'
);
assert.deepEqual(good.messages, []);
const [bad] = await allRules.lintText(
  'chrome.scripting.executeScript({target:{tabId:1},func:()=>1,files:["x.js"]}); chrome.scripting.executeScript({target:{tabId:1},func:(x)=>x,args:[undefined]});'
);
assert.deepEqual(
  bad.messages.map((message) => message.messageId),
  ['exclusiveSource', 'topLevelLoss']
);
console.log('Opt-in injection rules smoke passed.');
