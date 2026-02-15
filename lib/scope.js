const lookupVariableByName = (scope, name) => {
  let cursor = scope;

  while (cursor) {
    if (cursor.set?.has(name)) {
      return cursor.set.get(name);
    }
    cursor = cursor.upper;
  }

  return null;
};

export const isImportedVariable = (variable) => variable?.defs?.some((def) => def.type === 'ImportBinding') === true;

export const markSeenVariable = (variable, seenVariables) => {
  if (!variable || seenVariables.has(variable) || isImportedVariable(variable)) {
    return false;
  }
  seenVariables.add(variable);

  return true;
};

export const collectScopeTree = (rootScope) => {
  const scopes = new Set();
  const queue = [rootScope];
  let head = 0;

  while (head < queue.length) {
    const scope = queue[head++];

    if (!scope || scopes.has(scope)) {
      continue;
    }
    scopes.add(scope);
    for (const child of scope.childScopes ?? []) {
      queue.push(child);
    }
  }

  return scopes;
};

export const createScopeApi = (context) => {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  const scopeCache = new WeakMap();
  const variableCache = new WeakMap();
  const scopeVariableNameCache = new WeakMap();
  const NULL_SCOPE_KEY = Symbol('null-scope');

  const getScope = (node) => {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) {
      return null;
    }
    if (scopeCache.has(node)) {
      return scopeCache.get(node);
    }

    const resolvedScope = sourceCode.getScope?.(node) ?? context.getScope();
    scopeCache.set(node, resolvedScope ?? null);

    return resolvedScope ?? null;
  };

  const getScopeForNode = (node, fallbackScope) => {
    try {
      return getScope(node);
    } catch {
      return fallbackScope;
    }
  };

  const resolveVariableByName = (scope, name) => {
    if (!scope) {
      return null;
    }

    let cachedByName = scopeVariableNameCache.get(scope);

    if (!cachedByName) {
      cachedByName = new Map();
      scopeVariableNameCache.set(scope, cachedByName);
    } else if (cachedByName.has(name)) {
      return cachedByName.get(name);
    }

    const resolvedVariable = lookupVariableByName(scope, name);
    cachedByName.set(name, resolvedVariable);

    return resolvedVariable;
  };

  const resolveVariableFromIdentifier = (identifierNode, fallbackScope) => {
    const fallbackKey = fallbackScope ?? NULL_SCOPE_KEY;
    const cachedByFallback = variableCache.get(identifierNode);

    if (cachedByFallback?.has(fallbackKey)) {
      return cachedByFallback.get(fallbackKey);
    }

    const lookupScope = fallbackScope ?? getScopeForNode(identifierNode, null);
    let resolvedVariable = null;

    if (lookupScope) {
      resolvedVariable = resolveVariableByName(lookupScope, identifierNode.name);
    }

    if (!cachedByFallback) {
      variableCache.set(identifierNode, new Map([[fallbackKey, resolvedVariable]]));
    } else {
      cachedByFallback.set(fallbackKey, resolvedVariable);
    }

    return resolvedVariable;
  };

  return {
    getScope,
    getScopeForNode,
    resolveVariableByName,
    resolveVariableFromIdentifier,
  };
};
