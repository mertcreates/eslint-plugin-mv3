import {
  getObjectProperty,
  getStaticPropertyName,
  isFunctionLike,
  isTypeOnlyReference,
  unwrapChain,
} from '../lib/ast.js';
import { collectScopeTree, createScopeApi, isImportedVariable, markSeenVariable } from '../lib/scope.js';

const EXECUTE_SCRIPT_HOSTS = new Set(['chrome', 'browser']);

const isPotentialExecuteScriptShape = (calleeNode) => {
  const callee = unwrapChain(calleeNode);

  if (!callee) {
    return false;
  }
  if (callee.type === 'Identifier') {
    return true;
  }
  if (callee.type !== 'MemberExpression') {
    return false;
  }

  const propertyName = getStaticPropertyName(callee.property);

  return (
    propertyName === 'executeScript' ||
    propertyName === 'scripting' ||
    propertyName === 'call' ||
    propertyName === 'apply' ||
    propertyName === 'bind' ||
    propertyName === 'Reflect'
  );
};

const isArityCompatibleExecuteScriptCandidate = (callNode) => {
  const callee = unwrapChain(callNode.callee);

  if (!callee) {
    return false;
  }
  if (callee.type === 'Identifier') {
    return callNode.arguments.length <= 1;
  }
  if (callee.type !== 'MemberExpression') {
    return false;
  }

  const propertyName = getStaticPropertyName(callee.property);

  if (propertyName === 'executeScript') {
    return callNode.arguments.length <= 1;
  }
  if (propertyName === 'call' || propertyName === 'apply') {
    return callNode.arguments.length >= 2;
  }

  return true;
};

const resolveFromObjectPatternBinding = (variableDef, localName) => {
  const declarator = variableDef.node;

  if (declarator?.type !== 'VariableDeclarator' || declarator.id?.type !== 'ObjectPattern') {
    return null;
  }

  for (const property of declarator.id.properties) {
    if (property.type !== 'Property') {
      continue;
    }
    const valueNode = property.value?.type === 'AssignmentPattern' ? property.value.left : property.value;

    if (valueNode?.type !== 'Identifier' || valueNode.name !== localName) {
      continue;
    }

    const keyName = getStaticPropertyName(property.key);

    return {
      keyName,
      init: declarator.init ?? null,
    };
  }

  return null;
};

const isReflectObjectExpression = (node) => {
  const expr = unwrapChain(node);

  if (!expr) {
    return false;
  }
  if (expr.type === 'Identifier' && expr.name === 'Reflect') {
    return true;
  }
  if (expr.type !== 'MemberExpression') {
    return false;
  }

  const propertyName = getStaticPropertyName(expr.property);

  if (propertyName !== 'Reflect') {
    return false;
  }

  const base = unwrapChain(expr.object);

  return base?.type === 'Identifier' && (base.name === 'globalThis' || base.name === 'window' || base.name === 'self');
};

const isHostRuntimeExpression = (node, scopeApi, fallbackScope, seenVariables) => {
  const expr = unwrapChain(node);

  if (!expr) {
    return false;
  }
  if (expr.type === 'Identifier' && EXECUTE_SCRIPT_HOSTS.has(expr.name)) {
    return true;
  }
  if (expr.type !== 'Identifier') {
    return false;
  }

  const variable = scopeApi.resolveVariableFromIdentifier(expr, fallbackScope);

  if (!markSeenVariable(variable, seenVariables)) {
    return false;
  }

  for (const def of variable.defs) {
    if (def.type !== 'Variable') {
      continue;
    }
    const declarator = def.node;

    if (declarator?.type === 'VariableDeclarator' && declarator.id?.type === 'Identifier' && declarator.init) {
      const scopeAtInit = scopeApi.getScopeForNode(declarator.init, fallbackScope);

      if (isHostRuntimeExpression(declarator.init, scopeApi, scopeAtInit, seenVariables)) {
        return true;
      }
    }
  }

  return false;
};

const isScriptingExpression = (node, scopeApi, fallbackScope, seenVariables) => {
  const expr = unwrapChain(node);

  if (!expr) {
    return false;
  }
  if (expr.type === 'MemberExpression') {
    const propertyName = getStaticPropertyName(expr.property);

    if (propertyName !== 'scripting') {
      return false;
    }

    return isHostRuntimeExpression(
      expr.object,
      scopeApi,
      scopeApi.getScopeForNode(expr.object, fallbackScope),
      seenVariables
    );
  }
  if (expr.type !== 'Identifier') {
    return false;
  }

  const variable = scopeApi.resolveVariableFromIdentifier(expr, fallbackScope);

  if (!markSeenVariable(variable, seenVariables)) {
    return false;
  }

  for (const def of variable.defs) {
    if (def.type !== 'Variable') {
      continue;
    }
    const declarator = def.node;

    if (declarator?.type !== 'VariableDeclarator') {
      continue;
    }
    if (declarator.id?.type === 'Identifier' && declarator.init) {
      const scopeAtInit = scopeApi.getScopeForNode(declarator.init, fallbackScope);

      if (isScriptingExpression(declarator.init, scopeApi, scopeAtInit, seenVariables)) {
        return true;
      }
    }

    const binding = resolveFromObjectPatternBinding(def, variable.name);

    if (!binding || !binding.init || binding.keyName !== 'scripting') {
      continue;
    }

    const scopeAtInit = scopeApi.getScopeForNode(binding.init, fallbackScope);

    if (isHostRuntimeExpression(binding.init, scopeApi, scopeAtInit, seenVariables)) {
      return true;
    }
  }

  return false;
};

function isExecuteScriptContainerExpression(node, scopeApi, fallbackScope, seenVariables, refCache) {
  const expr = unwrapChain(node);

  if (!expr) {
    return false;
  }
  if (expr.type === 'ObjectExpression') {
    for (const property of expr.properties) {
      if (property.type !== 'Property' || property.computed) {
        continue;
      }
      const keyName = getStaticPropertyName(property.key);

      if (keyName !== 'executeScript') {
        continue;
      }
      if (isExecuteScriptReference(property.value, scopeApi, fallbackScope, seenVariables, refCache)) {
        return true;
      }
    }

    return false;
  }
  if (expr.type !== 'Identifier') {
    return false;
  }

  const variable = scopeApi.resolveVariableFromIdentifier(expr, fallbackScope);

  if (!markSeenVariable(variable, seenVariables)) {
    return false;
  }

  for (const def of variable.defs) {
    if (def.type !== 'Variable') {
      continue;
    }
    const declarator = def.node;

    if (declarator?.type !== 'VariableDeclarator' || declarator.id?.type !== 'Identifier' || !declarator.init) {
      continue;
    }

    const scopeAtInit = scopeApi.getScopeForNode(declarator.init, fallbackScope);

    if (isExecuteScriptContainerExpression(declarator.init, scopeApi, scopeAtInit, seenVariables, refCache)) {
      return true;
    }
  }

  return false;
}

function isBoundExecuteScriptReference(node, scopeApi, fallbackScope, seenVariables, refCache) {
  const expr = unwrapChain(node);

  if (!expr || expr.type !== 'CallExpression') {
    return false;
  }

  const callee = unwrapChain(expr.callee);

  if (!callee || callee.type !== 'MemberExpression') {
    return false;
  }

  const propertyName = getStaticPropertyName(callee.property);

  if (propertyName !== 'bind') {
    return false;
  }

  return isExecuteScriptReference(callee.object, scopeApi, fallbackScope, seenVariables, refCache);
}

function isExecuteScriptReference(calleeNode, scopeApi, fallbackScope, seenVariables, refCache) {
  const callee = unwrapChain(calleeNode);

  if (!callee) {
    return false;
  }
  if (callee.type === 'MemberExpression') {
    const propertyName = getStaticPropertyName(callee.property);

    if (propertyName !== 'executeScript') {
      return false;
    }

    const scopeAtObject = scopeApi.getScopeForNode(callee.object, fallbackScope);

    if (isScriptingExpression(callee.object, scopeApi, scopeAtObject, new Set(seenVariables))) {
      return true;
    }

    return isExecuteScriptContainerExpression(callee.object, scopeApi, scopeAtObject, new Set(seenVariables), refCache);
  }

  if (isBoundExecuteScriptReference(callee, scopeApi, fallbackScope, seenVariables, refCache)) {
    return true;
  }

  if (callee.type !== 'Identifier') {
    return false;
  }

  const variable = scopeApi.resolveVariableFromIdentifier(callee, fallbackScope);

  if (variable && refCache.has(variable)) {
    return refCache.get(variable);
  }

  if (!markSeenVariable(variable, seenVariables)) {
    return false;
  }

  for (const def of variable.defs) {
    if (def.type !== 'Variable') {
      continue;
    }
    const declarator = def.node;

    if (declarator?.type !== 'VariableDeclarator') {
      continue;
    }

    if (declarator.id?.type === 'Identifier' && declarator.init) {
      const scopeAtInit = scopeApi.getScopeForNode(declarator.init, fallbackScope);

      if (isExecuteScriptReference(declarator.init, scopeApi, scopeAtInit, seenVariables, refCache)) {
        refCache.set(variable, true);
        return true;
      }
      if (isExecuteScriptContainerExpression(declarator.init, scopeApi, scopeAtInit, seenVariables, refCache)) {
        refCache.set(variable, true);
        return true;
      }
      if (isBoundExecuteScriptReference(declarator.init, scopeApi, scopeAtInit, seenVariables, refCache)) {
        refCache.set(variable, true);
        return true;
      }
    }

    const binding = resolveFromObjectPatternBinding(def, variable.name);

    if (!binding || !binding.init || binding.keyName !== 'executeScript') {
      continue;
    }

    const scopeAtInit = scopeApi.getScopeForNode(binding.init, fallbackScope);

    if (
      isScriptingExpression(binding.init, scopeApi, scopeAtInit, seenVariables) ||
      isExecuteScriptContainerExpression(binding.init, scopeApi, scopeAtInit, seenVariables, refCache)
    ) {
      refCache.set(variable, true);
      return true;
    }
  }

  refCache.set(variable, false);
  return false;
}

const resolveExecuteScriptConfigArg = (callNode, scopeApi, refCache) => {
  const callScope = scopeApi.getScope(callNode);
  const callee = unwrapChain(callNode.callee);

  if (!callee) {
    return { matched: false, configNode: null, dynamic: false };
  }

  if (isExecuteScriptReference(callee, scopeApi, callScope, new Set(), refCache)) {
    return { matched: true, configNode: callNode.arguments[0] ?? null, dynamic: false };
  }
  if (callee.type !== 'MemberExpression') {
    return { matched: false, configNode: null, dynamic: false };
  }

  const invokeName = getStaticPropertyName(callee.property);

  if (invokeName !== 'call' && invokeName !== 'apply') {
    return { matched: false, configNode: null, dynamic: false };
  }

  const executeScriptTarget =
    invokeName === 'apply' && isReflectObjectExpression(callee.object) ? callNode.arguments[0] : callee.object;

  if (!isExecuteScriptReference(executeScriptTarget, scopeApi, callScope, new Set(), refCache)) {
    return { matched: false, configNode: null, dynamic: false };
  }

  if (invokeName === 'call') {
    return { matched: true, configNode: callNode.arguments[1] ?? null, dynamic: false };
  }

  const argsContainer = isReflectObjectExpression(callee.object) ? callNode.arguments[2] : callNode.arguments[1];

  if (!argsContainer || unwrapChain(argsContainer)?.type !== 'ArrayExpression') {
    return { matched: true, configNode: null, dynamic: true };
  }

  const argsArray = unwrapChain(argsContainer);
  const [firstArrayArg] = argsArray.elements;

  if (!firstArrayArg || firstArrayArg.type === 'SpreadElement') {
    return { matched: true, configNode: null, dynamic: true };
  }

  return { matched: true, configNode: firstArrayArg, dynamic: false };
};

const resolveFunctionNodeFromIdentifier = (identifierNode, scopeApi) => {
  const scope = scopeApi.getScope(identifierNode);
  const variable = scopeApi.resolveVariableByName(scope, identifierNode.name);

  if (!variable) {
    return { error: 'unresolved', functionNode: null };
  }
  if (isImportedVariable(variable)) {
    return { error: 'imported', functionNode: null };
  }

  for (const def of variable.defs) {
    if (def.type === 'FunctionName' && isFunctionLike(def.node)) {
      return { error: null, functionNode: def.node };
    }
    if (def.type === 'Variable' && def.node?.type === 'VariableDeclarator' && isFunctionLike(def.node.init)) {
      return { error: null, functionNode: def.node.init };
    }
  }

  return { error: 'notLocalFunction', functionNode: null };
};

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
      invalidArgs: '`executeScript` `args` must be an array literal (`args: [...]`).',
      dynamicConfig:
        '`executeScript` options must be a static object literal (no spread/dynamic config) so `func` and `args` can be validated.',
      dynamicInvoke:
        '`executeScript` call must pass statically analyzable options (`executeScript({...})`, `.call(_, {...})`, or `.apply(_, [{...}])`).',
    },
  },
  create(context) {
    const scopeApi = createScopeApi(context);
    const refCache = new WeakMap();
    const report = (node, messageId, data) => context.report({ node, messageId, ...(data ? { data } : {}) });

    return {
      CallExpression(node) {
        if (!isPotentialExecuteScriptShape(node.callee)) {
          return;
        }
        if (!isArityCompatibleExecuteScriptCandidate(node)) {
          return;
        }

        const resolvedInvocation = resolveExecuteScriptConfigArg(node, scopeApi, refCache);

        if (!resolvedInvocation.matched) {
          return;
        }
        if (resolvedInvocation.dynamic) {
          report(node, 'dynamicInvoke');

          return;
        }

        const firstArg = unwrapChain(resolvedInvocation.configNode);

        if (!firstArg || firstArg.type !== 'ObjectExpression') {
          report(node, 'dynamicConfig');

          return;
        }

        if (firstArg.properties.some((property) => property.type === 'SpreadElement')) {
          report(firstArg, 'dynamicConfig');
        }

        const funcProp = getObjectProperty(firstArg, 'func');

        if (!funcProp) {
          return;
        }

        let injectedFunctionNode;
        const funcValue = unwrapChain(funcProp.value);

        if (isFunctionLike(funcValue)) {
          injectedFunctionNode = funcValue;
        } else if (funcValue?.type === 'Identifier') {
          const resolved = resolveFunctionNodeFromIdentifier(funcValue, scopeApi);

          if (resolved.error === 'imported') {
            report(funcValue, 'importedFunc');

            return;
          }
          if (resolved.error || !resolved.functionNode) {
            report(funcValue, 'unresolvedFunc');

            return;
          }
          injectedFunctionNode = resolved.functionNode;
        } else {
          report(funcValue ?? funcProp, 'unresolvedFunc');

          return;
        }

        const argsProp = getObjectProperty(firstArg, 'args');

        if (injectedFunctionNode.params.length > 0) {
          if (!argsProp) {
            report(funcProp, 'missingArgs');
          } else if (unwrapChain(argsProp.value)?.type !== 'ArrayExpression') {
            report(argsProp.value, 'invalidArgs');
          }
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
