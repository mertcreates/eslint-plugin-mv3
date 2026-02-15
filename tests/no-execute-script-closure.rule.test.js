import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

import mainWorldExecuteScriptNoClosureRule from '../rules/no-execute-script-closure.js';

const RULE_ID = '@mertcreates/mv3/no-execute-script-closure';

const createLinter = () =>
  new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        languageOptions: {
          ecmaVersion: 2020,
          sourceType: 'module',
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

  return result.messages.filter((message) => message.ruleId === RULE_ID);
};

describe('@mertcreates/mv3/no-execute-script-closure', () => {
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

    expect(messages.some((message) => message.message.includes('`args` must be an array literal'))).toBe(true);
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

  test('fails when executeScript options use spread config', async () => {
    const messages = await lintMessages(`
      const options = { target: { tabId: 1 } };

      chrome.scripting.executeScript({
        ...options,
        func: () => Date.now(),
      });
    `);

    expect(messages.some((message) => message.message.includes('no spread/dynamic config'))).toBe(true);
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
      const invokeArgs = [{ target: { tabId: 1 }, func: () => Date.now() }];
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
      const invokeArgs = [{ target: { tabId: 1 }, func: () => Date.now() }];
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
