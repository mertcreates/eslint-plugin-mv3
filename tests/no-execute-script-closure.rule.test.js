import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

import mainWorldExecuteScriptNoClosureRule from '../rules/no-execute-script-closure.js';

const RULE_ID = '@mertcreates/mv3/no-execute-script-closure';
const eslintMajor = Number(ESLint.version.split('.')[0]);
const Linter = eslintMajor === 8 ? (await import('eslint/use-at-your-own-risk')).default.FlatESLint : ESLint;

const createLinter = () =>
  new Linter({
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          ecmaVersion: 2020,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: {
          '@mertcreates/mv3': {
            rules: {
              'no-execute-script-closure': mainWorldExecuteScriptNoClosureRule,
            },
          },
        },
        rules: {
          [RULE_ID]: 'error',
        },
      },
    ],
  });

const lintMessages = async (code) => {
  const linter = createLinter();
  const [result] = await linter.lintText(code, { filePath: 'fixture.js' });

  const unexpectedMessages = result.messages.filter((message) => message.ruleId !== RULE_ID || message.fatal);

  if (unexpectedMessages.length > 0) {
    throw new Error(`Unexpected lint diagnostics: ${JSON.stringify(unexpectedMessages)}`);
  }

  return result.messages;
};

describe('@mertcreates/mv3/no-execute-script-closure', () => {
  test.each([
    'const chrome = { scripting: { executeScript() {} } }; const TOP = 1; chrome.scripting.executeScript({ func: () => TOP });',
    'const scripting = "other"; const executeScript = "run"; const TOP = 1; chrome[scripting][executeScript]({ func: () => TOP });',
    'let execute = chrome.scripting.executeScript; execute = () => {}; const TOP = 1; execute({ func: () => TOP });',
  ])('ignores a call that is not the extension API: %s', async (code) => {
    expect(await lintMessages(code)).toHaveLength(0);
  });

  test('checks closures in a local constant options object', async () => {
    const messages = await lintMessages(`
      const TOP = 1;
      const options = { target: { tabId: 1 }, func: () => TOP };
      chrome.scripting.executeScript(options);
    `);
    expect(messages.map(({ messageId }) => messageId)).toEqual(['closureCapture']);
  });

  test('does not silently pass parsing failures', async () => {
    await expect(lintMessages('const = ;')).rejects.toThrow('Unexpected lint diagnostics');
  });

  test.skipIf(eslintMajor < 10)('reports outer JSX component references', async () => {
    const messages = await lintMessages(`
      const Card = () => null;
      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: () => <Card />,
      });
    `);

    expect(messages.map(({ messageId }) => messageId)).toEqual(['closureCapture']);
  });

  test('passes when a JSX component is declared inside the injected function', async () => {
    const messages = await lintMessages(`
      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: () => {
          const Card = () => null;
          return <Card />;
        },
      });
    `);

    expect(messages).toHaveLength(0);
  });

  test('passes when inline func is self-contained and args are explicit', async () => {
    const messages = await lintMessages(`
      chrome.scripting.executeScript({
        target: { tabId },
        func: (cfg) => {
          const data = { source: cfg.source, at: Date.now() };
          window.postMessage(data, '*');
        },
        args: [{ source: 'bugjar' }],
      });
    `);

    expect(messages).toHaveLength(0);
  });

  test('passes when function identifier is local and self-contained', async () => {
    const messages = await lintMessages(`
      function installBridge(cfg) {
        const state = { source: cfg.source };
        return window.location.href + state.source;
      }

      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
        args: [{ source: 'bugjar' }],
      });
    `);

    expect(messages).toHaveLength(0);
  });

  test('fails when injected function captures top-level constant', async () => {
    const messages = await lintMessages(`
      const BRIDGE_SOURCE = 'bugjar';

      function installBridge() {
        return BRIDGE_SOURCE;
      }

      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(
      messages.some((message) => message.message.includes('captures outer variable `BRIDGE_SOURCE`'))
    ).toBe(true);
  });

  test('fails when func is imported', async () => {
    const messages = await lintMessages(`
      import { installBridge } from './bridge';

      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('cannot use an imported function'))).toBe(true);
  });

  test('fails when params exist but args are missing', async () => {
    const messages = await lintMessages(`
      function installBridge(config) {
        return config;
      }

      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('Pass inputs with'))).toBe(true);
  });

  test('fails when args is not an array literal', async () => {
    const messages = await lintMessages(`
      function installBridge(config) {
        return config;
      }

      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
        args: configPayload,
      });
    `);

    expect(messages.map(({ messageId }) => messageId)).toEqual(['invalidArgs']);
  });

  test('passes with globals and nested local references', async () => {
    const messages = await lintMessages(`
      function installBridge(config) {
        const build = () => {
          const href = window.location.href;
          return { href, source: config.source, stamp: globalThis.Date.now() };
        };
        return build();
      }

      chrome.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
        args: [{ source: 'bugjar' }],
      });
    `);

    expect(messages).toHaveLength(0);
  });

  test('fails when executeScript is called through alias', async () => {
    const messages = await lintMessages(`
      const execute = chrome.scripting.executeScript;
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      execute({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when executeScript is destructured from scripting', async () => {
    const messages = await lintMessages(`
      const { executeScript } = chrome.scripting;
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when executeScript is reached through computed access', async () => {
    const messages = await lintMessages(`
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      chrome['scripting']['executeScript']({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('accepts a known spread config', async () => {
    const messages = await lintMessages(`
      const options = { target: { tabId: 1 } };

      chrome.scripting.executeScript({
        ...options,
        func: () => Date.now(),
      });
    `);

    expect(messages).toHaveLength(0);
  });

  test('fails when executeScript is invoked via .call', async () => {
    const messages = await lintMessages(`
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      chrome.scripting.executeScript.call(chrome.scripting, {
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when executeScript is invoked via .apply', async () => {
    const messages = await lintMessages(`
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      chrome.scripting.executeScript.apply(chrome.scripting, [{
        target: { tabId: 1 },
        func: installBridge,
      }]);
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when executeScript.apply args are dynamic', async () => {
    const messages = await lintMessages(`
      const invokeArgs = getArguments();
      chrome.scripting.executeScript.apply(chrome.scripting, invokeArgs);
    `);

    expect(messages.some((message) => message.message.includes('statically analyzable options'))).toBe(true);
  });

  test('fails when executeScript is called via object-wrapper alias', async () => {
    const messages = await lintMessages(`
      const api = { executeScript: chrome.scripting.executeScript };
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      api.executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when executeScript is invoked through bind alias', async () => {
    const messages = await lintMessages(`
      const run = chrome.scripting.executeScript.bind(chrome.scripting);
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      run({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when executeScript is invoked through Reflect.apply', async () => {
    const messages = await lintMessages(`
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      Reflect.apply(chrome.scripting.executeScript, chrome.scripting, [{
        target: { tabId: 1 },
        func: installBridge,
      }]);
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when Reflect.apply invocation is dynamic', async () => {
    const messages = await lintMessages(`
      const invokeArgs = getArguments();
      Reflect.apply(chrome.scripting.executeScript, chrome.scripting, invokeArgs);
    `);

    expect(messages.some((message) => message.message.includes('statically analyzable options'))).toBe(true);
  });

  test('fails when browser.scripting.executeScript captures outer scope', async () => {
    const messages = await lintMessages(`
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      browser.scripting.executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('fails when optional-chained executeScript captures outer scope', async () => {
    const messages = await lintMessages(`
      const TOP = 'outer';

      function installBridge() {
        return TOP;
      }

      chrome?.scripting?.executeScript?.({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages.some((message) => message.message.includes('captures outer variable `TOP`'))).toBe(true);
  });

  test('does not match non-MV3 executeScript-like APIs', async () => {
    const messages = await lintMessages(`
      const api = {
        executeScript(config) {
          return config;
        },
      };

      const TOP = 'outer';
      function installBridge() {
        return TOP;
      }

      api.executeScript({
        target: { tabId: 1 },
        func: installBridge,
      });
    `);

    expect(messages).toHaveLength(0);
  });
});
