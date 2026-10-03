import { isImportedVariable, collectScopeTree } from '../lib/scope.js';
import { isTypeOnlyReference } from '../lib/ast.js';
import { getInjectionAnalysis, property, isAbsentOption } from '../lib/injection-analysis.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce self-contained functions for chrome.scripting.executeScript({ func }).',
      url: 'https://github.com/mertcreates/eslint-plugin-mv3#no-execute-script-closure',
    },
    schema: [],
    messages: {
      unresolvedFunc:
        '`executeScript({ func })` must point to a local function declared in this file (inline it or define it above).',
      importedFunc:
        '`executeScript({ func })` cannot use an imported function. Define a local wrapper and pass input via `args`.',
      closureCapture:
        'Injected function captures outer variable `{{name}}`. Move that value into `args` so `func` is self-contained.',
      missingArgs:
        'Injected function has parameters but `args` is missing. Pass inputs with `executeScript({ ..., args: [...] })`.',
      invalidArgs: '`executeScript` `args` must resolve to an array (`args: [...]`).',
      dynamicConfig:
        '`executeScript` options must resolve to a static local object so `func` and `args` can be validated.',
      dynamicInvoke:
        '`executeScript` call must pass statically analyzable options (`executeScript({...})`, `.call(_, {...})`, or `.apply(_, [{...}])`).',
    },
  },
  create(context) {
    const analysis = getInjectionAnalysis(context);
    const scopeApi = analysis.scope;
    const report = (node, messageId, data) => context.report({ node, messageId, ...(data ? { data } : {}) });

    return {
      CallExpression(node) {
        const resolvedInvocation = analysis.calls.get(node);
        if (!resolvedInvocation) return;

        if (resolvedInvocation.dynamicInvoke) {
          report(node, 'dynamicInvoke');

          return;
        }

        const options = resolvedInvocation.config;
        if (options.kind !== 'object' || options.opaque) {
          report(node.arguments[0] ?? node, 'dynamicConfig');
          return;
        }
        if (options.unknownKeys) {
          report(options.node, 'dynamicConfig');
          return;
        }

        const func = property(options, 'func');
        if (isAbsentOption(func)) return;
        let injectedFunctionNode;
        if (func.kind === 'function') {
          injectedFunctionNode = func.node;
        } else {
          const variable = func.node?.type === 'Identifier' ? scopeApi.resolveVariableFromIdentifier(func.node) : null;
          report(func.node ?? options.node, isImportedVariable(variable) ? 'importedFunc' : 'unresolvedFunc');
          return;
        }
        const args = property(options, 'args');
        if (injectedFunctionNode.params.length > 0) {
          if (isAbsentOption(args)) report(func.node, 'missingArgs');
          else if (args.kind !== 'array' || args.opaque) report(args.node ?? options.node, 'invalidArgs');
        }

        const functionScope = scopeApi.getScope(injectedFunctionNode);

        if (!functionScope) {
          return;
        }

        const allowedScopes = collectScopeTree(functionScope);
        const reportedNames = new Set();
        const scopesToInspect = [...allowedScopes];

        for (const scope of scopesToInspect) {
          for (const reference of scope.references ?? []) {
            if (!reference.resolved || isTypeOnlyReference(reference)) {
              continue;
            }
            if (reference.init === true) {
              continue;
            }

            const variable = reference.resolved;

            if (variable.defs.length === 0) {
              continue;
            }
            if (allowedScopes.has(variable.scope)) {
              continue;
            }
            if (reportedNames.has(reference.identifier.name)) {
              continue;
            }

            reportedNames.add(reference.identifier.name);
            report(reference.identifier, 'closureCapture', { name: reference.identifier.name });
          }
        }
      },
    };
  },
};
