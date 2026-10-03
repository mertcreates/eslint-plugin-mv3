import { expect, test } from 'bun:test';
import { ESLint } from 'eslint';
import plugin from '../index.js';
const Linter =
  Number(ESLint.version.split('.')[0]) === 8
    ? (await import('eslint/use-at-your-own-risk')).default.FlatESLint
    : ESLint;
const optionsId = '@mertcreates/mv3/valid-execute-script-options';
const lint = async (code, rule = optionsId) => {
  const linter = new Linter({
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: { ecmaVersion: 2022 },
        plugins: { '@mertcreates/mv3': plugin },
        rules: { [rule]: 'error' },
      },
    ],
  });
  const [result] = await linter.lintText(code);
  if (result.messages.some((m) => m.fatal || m.ruleId !== rule)) throw new Error(JSON.stringify(result.messages));
  return result.messages;
};
const call = (options) => `chrome.scripting.executeScript(${options});`;

test.each([
  ['{target:{tabId:1},func:()=>1,files:["x.js"]}', 'exclusiveSource'],
  ['{target:{tabId:1}}', 'missingSource'],
  ['{target:{tabId:1},files:["x.js"],args:[]}', 'argsWithoutFunc'],
  ['{func:()=>1}', 'missingTarget'],
  ['{func:()=>1,target:{}}', 'missingTabId'],
  ['{func:()=>1,target:{tabId:"1"}}', 'invalidType'],
  ['{func:()=>1,target:{tabId:1},world:"main"}', 'invalidWorld'],
  ['{func:()=>1,target:{tabId:1},injectImmediately:1}', 'invalidType'],
  ['{func:()=>1,target:{tabId:1,allFrames:true,frameIds:[0]}}', 'frameConflict'],
  ['{func:()=>1,target:{tabId:1,documentIds:["x"],frameIds:[0]}}', 'documentConflict'],
])('reports proven option violation %s', async (options, id) => {
  expect((await lint(call(options))).map((m) => m.messageId)).toEqual([id]);
});

test.each([
  '{target:{tabId:1},func:()=>1}',
  '{target:{tabId:1},files:["x.js"]}',
  '{target:{tabId:1,allFrames:false,frameIds:[0]},func:()=>1}',
  '{target:{tabId:1,allFrames:true,documentIds:["x"]},func:()=>1}',
  '{...unknown}',
  '{func:()=>1,target:{...unknown}}',
  '{func:()=>1,target:{tabId:1},world:unknown}',
  '{func:()=>1,target:{tabId:1},files:undefined}',
])('accepts valid or uncertain options %s', async (options) => {
  expect(await lint(call(options))).toHaveLength(0);
});

test.each([
  'const chrome={scripting:{executeScript(){}}}; chrome.scripting.executeScript({});',
  'const scripting="other",executeScript="run"; chrome[scripting][executeScript]({});',
  'let execute=chrome.scripting.executeScript; execute=()=>{}; execute({});',
  'const o={}; if(flag) o.func=()=>1; chrome.scripting.executeScript(o);',
  'const o={}; flag && (o.func=()=>1); chrome.scripting.executeScript(o);',
  'const o={}; escape(o); chrome.scripting.executeScript(o);',
  'const o={get func(){return ()=>1}}; chrome.scripting.executeScript(o);',
  'chrome.scripting.executeScript=()=>{}; chrome.scripting.executeScript({});',
  'const api=chrome.scripting;api.executeScript=()=>{};chrome.scripting.executeScript({});',
])('avoids uncertain API/config diagnoses %s', async (code) => {
  expect(await lint(code)).toHaveLength(0);
});

test('uses the call-time snapshot through aliases and computed writes', async () => {
  const code = `const o={target:{tabId:1},func:()=>1}; const alias=o;
  chrome.scripting.executeScript(o); alias['files']=['x.js']; chrome.scripting.executeScript(o);`;
  const messages = await lint(code);
  expect(messages.map((m) => m.messageId)).toEqual(['exclusiveSource']);
  expect(messages[0].line).toBe(1); // The diagnostic points to the options value.
});

test.each([
  "chrome['scripting']['executeScript']({})",
  'const {executeScript:run}=browser.scripting;run({})',
  'const run=chrome.scripting.executeScript;run.call(null,{})',
  'const list=[{}];chrome.scripting.executeScript.apply(null,list)',
  'Reflect.apply(chrome.scripting.executeScript,null,[{}])',
  'const run=chrome.scripting.executeScript.bind(null,{});run()',
])('resolves the real API %s', async (code) => {
  expect((await lint(code)).map((m) => m.messageId)).toEqual(['missingSource', 'missingTarget']);
});

test('last duplicate and spread properties win', async () => {
  expect(
    await lint('const base={files:["x.js"]};' + call('{...base,files:undefined,func:()=>1,target:{tabId:1}}'))
  ).toHaveLength(0);
});

const lossId = '@mertcreates/mv3/no-execute-script-argument-loss';
const payload = (value) => call(`{target:{tabId:1},func:(x)=>x,args:[${value}]}`);
test.each([
  ['1n', 'rejected'],
  ['{n:1n}', 'bigintField'],
  ['[1n]', 'bigintElement'],
  ['undefined', 'topLevelLoss'],
  ['()=>1', 'topLevelLoss'],
  ['Symbol("x")', 'topLevelLoss'],
  ['NaN', 'topLevelLoss'],
  ['-Infinity', 'topLevelLoss'],
  ['{settings:{callback:()=>1}}', 'omitted'],
  ['[undefined]', 'nullValue'],
  ['{n:Infinity}', 'nonFiniteField'],
])('diagnoses common transfer problem %s', async (value, id) => {
  const messages = await lint(payload(value), lossId);
  expect(messages.map((m) => m.messageId)).toEqual([id]);
  const source = value === 'undefined' ? 'undefined' : value === '1n' ? '1n' : value === 'NaN' ? 'NaN' : null;
  if (source) expect(messages[0].column).toBe(payload(value).indexOf(source) + 1);
});

test('reports the nested value path', async () => {
  const messages = await lint(payload('{settings:{callback:()=>1}}'), lossId);
  expect(messages[0].messageId).toBe('omitted');
  expect(messages[0].message).toContain('args[0].settings.callback');
});

test.each([
  'const shared={ok:true};' + payload('[shared,shared]'),
  payload('{name:"mv3",items:[1,true,null]}'),
  payload('new Date("2026-01-01")'),
  payload('{toJSON(){return {ok:true}},bad:()=>1}'),
  'const x={bad:()=>1};escape(x);' + payload('x'),
  'const x={bad:()=>1};if(flag)x.bad=null;' + payload('x'),
  'const x={bad:()=>1};flag ? (x.bad=null) : 1;' + payload('x'),
  'const x={bad:()=>1}; const get=()=>x; mutate(get);' + payload('x'),
  call('{target:{tabId:1},files:["x.js"],args:[undefined]}'),
  payload('{get bad(){return undefined}}'),
])('accepts valid or uncertain transfer %s', async (code) => {
  expect(await lint(code, lossId)).toHaveLength(0);
});

test('distinguishes a cycle from repeated references', async () => {
  const messages = await lint('const x={};const alias=x;alias.self=x;' + payload('x'), lossId);
  expect(messages.map((m) => m.messageId)).toEqual(['cycle']);
  expect(messages[0].message).toContain('args[0].self');
});

test('tracks nested aliases and mutations at each call', async () => {
  const messages = await lint(
    `const data={settings:{callback:null}}; const alias=data.settings;
  ${payload('data')} alias.callback=()=>1; ${payload('data')} alias.callback=null; ${payload('data')}`,
    lossId
  );
  expect(messages.map((m) => m.messageId)).toEqual(['omitted']);
  expect(messages[0].message).toContain('args[0].settings.callback');
});

test.each([
  'const x={bad:()=>1}; function change(){x.bad=null} change.call(null);' + payload('x'),
  'const x={bad:()=>1}; Reflect.apply(unknown,null,[x]);' + payload('x'),
  'const x={bad:()=>1};export {x};' + payload('x'),
  'if(flag)chrome.scripting.executeScript=()=>{};chrome.scripting.executeScript({});',
])('accounts for indirect escape or conditional API mutation %s', async (code) => {
  expect(await lint(code, code.includes('func:') ? lossId : optionsId)).toHaveLength(0);
});

test('keeps the first bound options across repeated bind', async () => {
  expect(
    await lint('const run=chrome.scripting.executeScript.bind(null,{target:{tabId:1},func:()=>1});run.bind(null,{})()')
  ).toHaveLength(0);
});

test.each([
  'const x={bad:()=>1};globalThis.saved=x;' + payload('x'),
  'const x={bad:()=>1};saved=x;' + payload('x'),
  'const x={bad:()=>1}; function Change(){x.bad=null} new Change();' + payload('x'),
])('accounts for external storage and constructor effects %s', async (code) => {
  expect(await lint(code, lossId)).toHaveLength(0);
});

test('uses the last value when an accessor is overwritten', async () => {
  expect(await lint(call('{get func(){return unknown},func:()=>1,target:{tabId:1}}'))).toHaveLength(0);
});

test('handles sparse array mutations without expanding the holes', async () => {
  const messages = await lint('const values=[];values[1000000000]=1;' + payload('values'), lossId);
  expect(messages.map((m) => m.messageId)).toEqual(['nullValue']);
  expect(messages[0].message).toContain('args[0][0]');
});

test('leaves sibling values uncertain when a serializer can mutate them', async () => {
  expect(
    await lint('const data={settings:{toJSON(){data.bad=1;return {}}},bad:undefined};' + payload('data'), lossId)
  ).toHaveLength(0);
});

test.each([
  'Reflect.apply=()=>{};Reflect.apply(chrome.scripting.executeScript,null,[{}]);',
  'if(flag)globalThis.chrome={};chrome.scripting.executeScript({});',
])('ignores replaced global invocation paths %s', async (code) => {
  expect(await lint(code)).toHaveLength(0);
});

test.each([
  'const data={bad:undefined};function consume(value){value.run()}consume({run(){data.bad=1}});' + payload('data'),
  'const data={bad:undefined};if(flag)unknown(()=>{data.bad=1});' + payload('data'),
  'function replace(api){api.executeScript=()=>{}}replace(chrome.scripting);chrome.scripting.executeScript({});',
  'let execute=chrome.scripting.executeScript;function reset(){execute=()=>{}}if(flag)reset();execute({});',
  'let execute=chrome.scripting.executeScript;if(flag)({execute}=other);execute({});',
])('invalidates values and bindings that can escape or change %s', async (code) => {
  expect(await lint(code, code.includes('args:') ? lossId : optionsId)).toHaveLength(0);
});

test.each([false, true])('isolates API mutations in unrelated function bodies (reverse=%s)', async (reverse) => {
  const unused = 'function unused(){chrome.scripting.executeScript=()=>{}}';
  const install = 'function install(){const TOP=1;chrome.scripting.executeScript({func:()=>TOP})}';
  const code = (reverse ? install + unused : unused + install) + 'install();';
  expect((await lint(code, '@mertcreates/mv3/no-execute-script-closure')).map((message) => message.messageId)).toEqual([
    'closureCapture',
  ]);
});

test('retains closure diagnostics for a real injection inside conditional flow', async () => {
  const code = 'const TOP=1;if(flag)chrome.scripting.executeScript({target:{tabId:1},func:()=>TOP});';
  expect((await lint(code, '@mertcreates/mv3/no-execute-script-closure')).map((message) => message.messageId)).toEqual([
    'closureCapture',
  ]);
});

test.each([
  'const data={bad:undefined};export const change=()=>{data.bad=1};' + payload('data'),
  'const data={bad:undefined};globalThis.change=()=>{data.bad=1};' + payload('data'),
])('invalidates captured values when callbacks are externally accessible %s', async (code) => {
  expect(await lint(code, lossId)).toHaveLength(0);
});

test('keeps sparse spread bounded while preserving later indices', async () => {
  const messages = await lint('const values=[];values[1000000000]=1;' + payload('[...values,undefined]'), lossId);
  expect(messages.map((message) => message.messageId)).toEqual(['nullValue', 'nullValue']);
  expect(messages[0].message).toContain('args[0][0]');
  expect(messages[1].message).toContain('args[0][1000000001]');
});

test('treats getter side effects as uncertain without evaluating the getter', async () => {
  const code = 'const data={bad:undefined};const object={get value(){data.bad=1}};object.value;' + payload('data');
  expect(await lint(code, lossId)).toHaveLength(0);
});

test.each(['{toJSON(){data.bad=1;return {}}}', '{get value(){data.bad=1;return 1}}'])(
  'invalidates later facts affected by serialization hooks %s',
  async (hook) => {
    const code = 'const data={bad:undefined};const hook=' + hook + ';' + payload('hook') + payload('data');
    expect(await lint(code, lossId)).toHaveLength(0);
  }
);

test('keeps deferred namespace facts uncertain after surrounding mutation', async () => {
  expect(
    await lint('const api=chrome.scripting;function run(){api.executeScript({})}api.executeScript=()=>{};run();')
  ).toHaveLength(0);
});

test('resolves an immutable API alias declared after a function body', async () => {
  const messages = await lint('function run(){execute({})}const execute=chrome.scripting.executeScript;run();');
  expect(messages.map((message) => message.messageId)).toEqual(['missingSource', 'missingTarget']);
});

test.each([
  '{target:{tabId:1},func:null,files:["x.js"]}',
  '{target:{tabId:1},files:null,func:()=>1,args:null,world:null,injectImmediately:null}',
  '{target:{tabId:1,allFrames:null,frameIds:null,documentIds:null},func:()=>1}',
])('accepts browser omission of optional null values %s', async (options) => {
  expect(await lint(call(options))).toHaveLength(0);
  expect(await lint(call(options), '@mertcreates/mv3/no-execute-script-closure')).toHaveLength(0);
});

test('still detects payload loss when optional files is null', async () => {
  const messages = await lint(call('{target:{tabId:1},files:null,func:x=>x,args:[undefined]}'), lossId);
  expect(messages.map((message) => message.messageId)).toEqual(['topLevelLoss']);
});

test('treats setter side effects as uncertain without executing user code', async () => {
  const code = 'const data={bad:undefined};const object={set value(x){data.bad=x}};object.value=1;' + payload('data');
  expect(await lint(code, lossId)).toHaveLength(0);
});
