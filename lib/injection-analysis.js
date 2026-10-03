import { createScopeApi, collectScopeTree } from './scope.js';
import { unwrapChain } from './ast.js';

const analyses = new WeakMap();
const UNKNOWN = Object.freeze({ kind: 'unknown' });
const primitive = (value, node) => ({ kind: 'primitive', value, node });
const isContainer = (value) => value?.kind === 'object' || value?.kind === 'array';
export const isUndefined = (value) => value?.kind === 'primitive' && value.value === undefined;
export const isAbsentOption = (value) => value?.kind === 'primitive' && value.value == null;
export const property = (value, key) => {
  if (!isContainer(value) || value.opaque) return UNKNOWN;
  return value.properties.get(key) ?? (value.unknownKeys ? UNKNOWN : primitive(undefined, value.node));
};

const arrayIndex = (key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 4_294_967_295;
// Report the first hole in each sparse range without expanding large arrays.
export const arrayItems = (value) => {
  const entries = [...value.properties].filter(([key]) => arrayIndex(key)).sort(([a], [b]) => Number(a) - Number(b));
  const items = [];
  let next = 0;
  for (const [key, child] of entries) {
    if (Number(key) > next) items.push([String(next), primitive(undefined, value.node)]);
    items.push([key, child]);
    next = Number(key) + 1;
  }
  if (next < value.length) items.push([String(next), primitive(undefined, value.node)]);
  return items;
};

// One analysis per SourceCode lets every rule use the same call-time facts.
export const getInjectionAnalysis = (context) => {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  if (analyses.has(sourceCode)) return analyses.get(sourceCode);
  const scope = createScopeApi(context);
  const calls = new WeakMap();
  const functions = [];
  const queuedFunctions = new WeakSet();
  let snapshots = new WeakMap();
  const hookCache = new WeakMap();

  const variable = (node) => scope.resolveVariableFromIdentifier(node) ?? node.name;
  const snapshot = (value) => {
    if (!isContainer(value)) return value;
    if (snapshots.has(value)) return snapshots.get(value);
    const copy = { ...value, properties: new Map() };
    snapshots.set(value, copy);
    for (const [key, child] of value.properties) copy.properties.set(key, snapshot(child));
    return copy;
  };
  const copyEnvironment = (env) => {
    const copies = new WeakMap();
    const clone = (value) => {
      if (!isContainer(value)) return value;
      if (copies.has(value)) return copies.get(value);
      const copy = { ...value, properties: new Map() };
      copies.set(value, copy);
      for (const [key, child] of value.properties) copy.properties.set(key, clone(child));
      return copy;
    };
    const copy = new Map([...env].map(([key, value]) => [key, clone(value)]));
    copy.disabledPaths = new Set(env.disabledPaths);
    return copy;
  };
  const invalidate = (value, seen = new Set()) => {
    if (!isContainer(value) || seen.has(value)) return;
    seen.add(value);
    for (const child of value.properties.values()) invalidate(child, seen);
    value.opaque = true;
    snapshots = new WeakMap();
  };
  const invalidateBinding = (node, env, seen = new Set()) => {
    if (node?.type === 'Identifier') {
      const key = variable(node);
      invalidate(env.get(key));
      env.set(key, UNKNOWN);
    } else if (node?.type === 'MemberExpression') {
      const base = peek(node.object, env);
      if (isContainer(base) && base.opaque) escape(base, env, seen);
      invalidate(base);
      if (base.kind === 'api') env.disabledPaths.add(base.path.join('.'));
      if (base.kind === 'reflect') env.disabledPaths.add('Reflect');
      if (base.kind === 'global') {
        const key = node.computed ? peek(node.property, env).value : node.property.name;
        for (const name of ['chrome', 'browser', 'Reflect'])
          if (key === undefined || key === name) env.disabledPaths.add(name);
      }
    } else if (node) {
      for (const key of sourceCode.visitorKeys[node.type] ?? []) {
        const children = node[key];
        for (const child of Array.isArray(children) ? children : [children]) if (child) invalidateBinding(child, env, seen);
      }
    }
  };
  const queueFunction = (node, env) => {
    if (queuedFunctions.has(node)) return;
    queuedFunctions.add(node);
    const referenced = new Map();
    const functionScope = scope.getScope(node);
    if (functionScope) {
      for (const child of collectScopeTree(functionScope)) {
        for (const ref of child.references ?? []) {
          const key = variable(ref.identifier);
          if (env.has(key) || key?.defs?.length) referenced.set(key, env.get(key) ?? UNKNOWN);
        }
      }
    }
    const captured = referenced;
    captured.disabledPaths = new Set(env.disabledPaths);
    // A deferred body may run before or after surrounding mutations.
    for (const [key, value] of captured) {
      if (isContainer(value) || value.boundConfig || key?.references?.some((ref) => ref.isWrite() && !ref.init))
        captured.set(key, UNKNOWN);
    }
    functions.push({ node, env: captured, owner: env });
  };
  const keyOf = (node, computed, env) => {
    if (!computed && node.type === 'Identifier') return node.name;
    const value = read(node, env);
    if (value.kind !== 'primitive' || !['string', 'number'].includes(typeof value.value)) return null;
    return String(value.value);
  };
  const member = (base, key, env) => {
    if (key === null) return UNKNOWN;
    if (base.kind === 'global' && ['chrome', 'browser'].includes(key)) return { kind: 'api', path: [key] };
    if (base.kind === 'global' && key === 'Reflect')
      return env.disabledPaths.has('Reflect') ? UNKNOWN : { kind: 'reflect' };
    if (base.kind === 'api') {
      const path = [...base.path, key];
      if ([...env.disabledPaths].some((disabled) => path.join('.').startsWith(disabled))) return UNKNOWN;
      if (base.path.length === 1 && key === 'scripting') return { kind: 'api', path };
      if (base.path.length === 2 && key === 'executeScript') return { kind: 'api', path };
      if (base.path.length === 3 && ['call', 'apply', 'bind'].includes(key))
        return { kind: 'invoke', method: key, target: base };
      return UNKNOWN;
    }
    if (base.kind === 'reflect' && key === 'apply') return { kind: 'invoke', method: 'reflectApply' };
    if (base.kind === 'number' && key === 'NaN') return primitive(NaN);
    if (base.kind === 'number' && key === 'POSITIVE_INFINITY') return primitive(Infinity);
    if (base.kind === 'number' && key === 'NEGATIVE_INFINITY') return primitive(-Infinity);
    return property(base, key);
  };
  const bindPattern = (pattern, value, env) => {
    if (pattern.type === 'Identifier') env.set(variable(pattern), value);
    else if (pattern.type === 'ObjectPattern') {
      for (const part of pattern.properties) {
        if (part.type === 'RestElement') bindPattern(part.argument, UNKNOWN, env);
        else bindPattern(part.value, member(value, keyOf(part.key, part.computed, env), env), env);
      }
    } else if (pattern.type === 'ArrayPattern') {
      pattern.elements.forEach((part, index) => {
        if (part) bindPattern(part, property(value, String(index)), env);
      });
    } else if (pattern.type === 'AssignmentPattern') {
      bindPattern(pattern.left, isUndefined(value) ? read(pattern.right, env) : value, env);
    } else if (pattern.type === 'RestElement') bindPattern(pattern.argument, UNKNOWN, env);
  };
  const write = (left, value, env, operator) => {
    if (left.type === 'Identifier') {
      const key = variable(left);
      if (!key?.defs?.length) escape(value, env);
      if (operator !== '=') invalidate(env.get(key));
      env.set(key, operator === '=' ? value : UNKNOWN);
    } else if (left.type === 'MemberExpression') {
      const base = read(left.object, env);
      if (isContainer(base) && base.opaque) escape(base, env);
      if (base.kind === 'api' || base.kind === 'global' || base.kind === 'reflect') {
        escape(value, env);
        const key = keyOf(left.property, left.computed, env);
        if (base.kind === 'api') env.disabledPaths.add([...base.path, ...(key === null ? [] : [key])].join('.'));
        else if (base.kind === 'reflect') env.disabledPaths.add('Reflect');
        else if (key === null) for (const name of ['chrome', 'browser', 'Reflect']) env.disabledPaths.add(name);
        else if (['chrome', 'browser', 'Reflect'].includes(key)) env.disabledPaths.add(key);
        const root = left.object;
        if (root.type === 'Identifier') env.set(variable(root), UNKNOWN);
        else if (root.type === 'MemberExpression') invalidateBinding(root.object, env);
        return;
      }
      const key = keyOf(left.property, left.computed, env);
      if (
        isContainer(base) &&
        !base.opaque &&
        key !== null &&
        operator === '=' &&
        key !== '__proto__' &&
        key !== 'length'
      ) {
        base.properties.set(key, value);
        if (base.kind === 'array' && arrayIndex(key)) base.length = Math.max(base.length, Number(key) + 1);
        snapshots = new WeakMap();
      } else {
        invalidate(base);
        escape(value, env);
      }
    } else bindPattern(left, operator === '=' ? value : UNKNOWN, env);
  };
  // Serializers may run during argument transfer and invalidate facts used by later calls.
  const serializationHooks = (value, ancestors = new Set()) => {
    if (!isContainer(value)) return { hooks: [], cyclic: false };
    if (hookCache.has(value)) return hookCache.get(value);
    if (ancestors.has(value)) return { hooks: [], cyclic: true };
    ancestors.add(value);
    const hooks = new Set();
    let cyclic = false;
    for (const [key, child] of value.properties) {
      if (child.kind === 'accessor') for (const fn of child.functions) hooks.add(fn);
      else if (key === 'toJSON' && child.kind === 'function') hooks.add(child);
      const nested = serializationHooks(child, ancestors);
      for (const hook of nested.hooks) hooks.add(hook);
      cyclic = cyclic || nested.cyclic;
    }
    ancestors.delete(value);
    const result = { hooks: [...hooks], cyclic };
    if (!cyclic) hookCache.set(value, result);
    return result;
  };
  const record = (node, target, config, env, dynamicInvoke = false) => {
    if (target?.kind !== 'api' || target.path.length !== 3) return;
    const captured = snapshot(config);
    calls.set(node, { node, config: captured, dynamicInvoke });
    for (const hook of serializationHooks(captured).hooks) escape(hook, env);
  };
  // Escape applies to the complete reachable graph, including callbacks and API namespaces.
  const escape = (value, env, seen = new Set()) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (isContainer(value)) {
      for (const child of value.properties.values()) escape(child, env, seen);
      invalidate(value);
    } else if (value.kind === 'api') {
      if (value.path.length < 3) env.disabledPaths.add(value.path.join('.'));
      escape(value.boundConfig, env, seen);
    } else if (value.kind === 'invoke') escape(value.target, env, seen);
    else if (value.kind === 'accessor') for (const fn of value.functions) escape(fn, env, seen);
    else if (value.kind === 'reflect') env.disabledPaths.add('Reflect');
    else if (value.kind === 'global') {
      for (const name of ['chrome', 'browser', 'Reflect']) env.disabledPaths.add(name);
    } else if (value.kind === 'function' && !seen.has(value.node)) {
      seen.add(value.node);
      const functionScope = scope.getScope(value.node);
      if (!functionScope) return;
      for (const child of collectScopeTree(functionScope)) {
        for (const ref of child.references ?? []) {
          const key = variable(ref.identifier);
          const captured = env.get(key);
          const parent = ref.identifier.parent;
          const globalMemberAccess =
            captured?.kind === 'global' && parent?.type === 'MemberExpression' && parent.object === ref.identifier;
          // Member access is checked by taintEffects; it does not expose the global object itself.
          if (!globalMemberAccess) escape(captured, env, seen);
          if (ref.isWrite() && !ref.init) env.set(key, UNKNOWN);
        }
      }
      taintEffects(value.node.body, env, seen);
    }
  };
  const escapeReceiver = (value, env, seen) => {
    // Calling a global method does not expose the whole global object as an argument.
    if (value.kind !== 'global') escape(value, env, seen);
  };
  const readCall = (node, env) => {
    const callee = read(node.callee, env);
    const args = node.arguments.map((arg) => (arg.type === 'SpreadElement' ? UNKNOWN : read(arg, env)));
    if (callee.kind === 'api' && callee.path.length === 3) {
      record(node, callee, callee.boundConfig ?? args[0] ?? primitive(undefined, node), env);
      return UNKNOWN;
    }
    if (callee.kind === 'invoke') {
      const target = callee.method === 'reflectApply' ? args[0] : callee.target;
      if (callee.method === 'bind' && target?.kind === 'api') {
        return {
          ...target,
          ...(args.length > 1 && {
            boundConfig: target.boundConfig ?? args[1],
          }),
        };
      }
      if (target?.kind !== 'api') {
        for (const arg of args) escape(arg, env);
        escape(target, env);
        return UNKNOWN;
      }
      if (callee.method === 'call')
        record(node, target, target.boundConfig ?? args[1] ?? primitive(undefined, node), env);
      else {
        const list = args[callee.method === 'reflectApply' ? 2 : 1];
        record(node, target, target?.boundConfig ?? property(list, '0'), env, list?.kind !== 'array' || list.opaque);
      }
      return UNKNOWN;
    }
    if (callee.kind === 'symbolFactory') return { kind: 'symbol', node };
    escape(callee, env);
    for (const arg of args) escape(arg, env);
    if (node.callee.type === 'MemberExpression') escapeReceiver(peek(node.callee.object, env), env);
    return UNKNOWN;
  };
  function read(rawNode, env) {
    const node = unwrapChain(rawNode);
    if (!node) return UNKNOWN;
    switch (node.type) {
      case 'Literal':
        return node.regex ? UNKNOWN : primitive(node.value, node);
      case 'Identifier': {
        const binding = variable(node);
        if (env.has(binding)) return env.get(binding);
        if (binding?.defs?.length) {
          const def = binding.defs[0];
          if (def.type === 'FunctionName') return { kind: 'function', node: def.node };
          return { kind: 'unknown', node };
        }
        if (['chrome', 'browser'].includes(node.name)) return { kind: 'api', path: [node.name] };
        if (['globalThis', 'window', 'self'].includes(node.name)) return { kind: 'global' };
        if (node.name === 'Reflect') return env.disabledPaths.has('Reflect') ? UNKNOWN : { kind: 'reflect' };
        if (node.name === 'Symbol') return { kind: 'symbolFactory' };
        if (node.name === 'Date') return { kind: 'dateFactory' };
        if (node.name === 'Number') return { kind: 'number' };
        if (node.name === 'undefined') return primitive(undefined, node);
        if (node.name === 'NaN') return primitive(NaN, node);
        if (node.name === 'Infinity') return primitive(Infinity, node);
        return UNKNOWN;
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        queueFunction(node, env);
        return { kind: 'function', node };
      case 'ObjectExpression': {
        const value = {
          kind: 'object',
          properties: new Map(),
          node,
          unknownKeys: false,
        };
        for (const part of node.properties) {
          if (part.type === 'SpreadElement') {
            const spread = read(part.argument, env);
            if (spread.kind === 'object' && !spread.opaque) {
              if (spread.unknownKeys) {
                value.properties.clear();
                value.unknownKeys = true;
              }
              for (const [key, child] of spread.properties) value.properties.set(key, child);
            } else {
              value.properties.clear();
              value.unknownKeys = true;
            }
            continue;
          }
          const key = keyOf(part.key, part.computed, env);
          const child = read(part.value, env);
          if (key === null) {
            value.properties.clear();
            value.unknownKeys = true;
          } else if (key === '__proto__') {
            value.opaque = true;
          } else if (part.kind !== 'init') {
            const previous = value.properties.get(key);
            value.properties.set(key, { kind: 'accessor', functions: [...(previous?.functions ?? []), child] });
          } else value.properties.set(key, child);
        }
        if ([...value.properties.values()].some((child) => child.kind === 'accessor')) value.opaque = true;
        return value;
      }
      case 'ArrayExpression': {
        const value = {
          kind: 'array',
          properties: new Map(),
          node,
          length: 0,
          unknownKeys: false,
        };
        for (const part of node.elements) {
          if (part?.type === 'SpreadElement') {
            const spread = read(part.argument, env);
            if (spread.kind !== 'array' || spread.opaque || spread.unknownKeys) {
              value.opaque = true;
              continue;
            }
            for (const [key, child] of spread.properties) {
              if (arrayIndex(key)) value.properties.set(String(value.length + Number(key)), child);
            }
            value.length += spread.length;
          } else value.properties.set(String(value.length++), part ? read(part, env) : primitive(undefined, node));
        }
        return value;
      }
      case 'MemberExpression': {
        const base = read(node.object, env);
        if (isContainer(base) && base.opaque) escape(base, env);
        const value = member(base, keyOf(node.property, node.computed, env), env);
        return value.kind === 'primitive' && !value.node ? { ...value, node } : value;
      }
      case 'CallExpression':
        return readCall(node, env);
      case 'NewExpression': {
        for (const arg of node.arguments) escape(read(arg, env), env);
        const constructor = read(node.callee, env);
        escape(constructor, env);
        return constructor.kind === 'dateFactory' ? { kind: 'date', node } : UNKNOWN;
      }
      case 'AssignmentExpression': {
        const value = read(node.right, env);
        write(node.left, value, env, node.operator);
        return value;
      }
      case 'UpdateExpression':
        invalidateBinding(node.argument, env);
        return UNKNOWN;
      case 'UnaryExpression': {
        if (node.operator === 'delete') {
          invalidateBinding(node.argument, env);
          return UNKNOWN;
        }
        const value = read(node.argument, env);
        if (value.kind !== 'primitive') return UNKNOWN;
        if (node.operator === '-') return primitive(-value.value, node);
        if (node.operator === '+' && typeof value.value !== 'bigint') return primitive(+value.value, node);
        if (node.operator === '!') return primitive(!value.value, node);
        if (node.operator === 'void') return primitive(undefined, node);
        return UNKNOWN;
      }
      case 'TemplateLiteral': {
        if (node.expressions.length) return UNKNOWN;
        return primitive(node.quasis[0].value.cooked, node);
      }
      case 'ConditionalExpression':
      case 'LogicalExpression':
        taintEffects(node, env);
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const child = node[key];
          if (child) read(child, copyEnvironment(env));
        }
        return UNKNOWN;
      case 'SequenceExpression': {
        let value = UNKNOWN;
        for (const expression of node.expressions) value = read(expression, env);
        return value;
      }
      default:
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const children = node[key];
          for (const child of Array.isArray(children) ? children : [children]) if (child) read(child, env);
        }
        return UNKNOWN;
    }
  }
  // Effect collection never models branch assignments as executed.
  const peek = (node, env) => {
    if (node?.type === 'Identifier' || node?.type === 'Literal') return read(node, env);
    if (['FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type)) return { kind: 'function', node };
    if (node?.type === 'MemberExpression') {
      const key = !node.computed
        ? node.property.name
        : node.property.type === 'Literal'
          ? String(node.property.value)
          : null;
      return member(peek(node.object, env), key, env);
    }
    return UNKNOWN;
  };
  const escapeExpression = (node, env, seen) => {
    if (!node) return;
    escape(peek(node, env), env, seen);
    if (['FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return;
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const children = node[key];
      for (const child of Array.isArray(children) ? children : [children])
        if (child) escapeExpression(child, env, seen);
    }
  };
  const isInjectionCall = (node, env) => {
    const callee = peek(node.callee, env);
    if (callee.kind === 'api') return callee.path.length === 3;
    if (callee.kind !== 'invoke') return false;
    const target = callee.method === 'reflectApply' ? peek(node.arguments[0], env) : callee.target;
    return target?.kind === 'api' && target.path.length === 3;
  };
  const taintEffects = (node, env, seen = new Set()) => {
    if (!node) return;
    if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)) return;
    if (node.type === 'AssignmentExpression') invalidateBinding(node.left, env, seen);
    if (node.type === 'UpdateExpression' || (node.type === 'UnaryExpression' && node.operator === 'delete'))
      invalidateBinding(node.argument, env, seen);
    if (node.type === 'CallExpression' && !isInjectionCall(node, env)) {
      for (const arg of node.arguments) escapeExpression(arg, env, seen);
      if (node.callee.type === 'MemberExpression') escapeReceiver(peek(node.callee.object, env), env, seen);
      escape(peek(node.callee, env), env, seen);
    }
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      const children = node[key];
      for (const child of Array.isArray(children) ? children : [children]) if (child) taintEffects(child, env, seen);
    }
  };
  const walk = (node, env) => {
    if (!node) return;
    switch (node.type) {
      case 'Program':
      case 'BlockStatement':
        for (const statement of node.body) walk(statement, env);
        break;
      case 'VariableDeclaration':
        for (const declarator of node.declarations) bindPattern(declarator.id, read(declarator.init, env), env);
        break;
      case 'FunctionDeclaration':
        if (node.id) env.set(variable(node.id), { kind: 'function', node });
        queueFunction(node, env);
        break;
      case 'ExpressionStatement':
        read(node.expression, env);
        break;
      case 'ReturnStatement':
      case 'ThrowStatement':
        read(node.argument, env);
        break;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        walk(node.declaration, env);
        if (node.declaration?.type === 'Identifier') {
          escape(peek(node.declaration, env), env);
          invalidateBinding(node.declaration, env);
        }
        for (const specifier of node.specifiers ?? []) {
          escape(peek(specifier.local, env), env);
          invalidateBinding(specifier.local, env);
        }
        taintEffects(node.declaration, env);
        if (node.declaration?.type === 'VariableDeclaration') {
          for (const item of node.declaration.declarations) {
            escape(peek(item.id, env), env);
            invalidateBinding(item.id, env);
          }
        }
        break;
      case 'IfStatement':
      case 'ForStatement':
      case 'ForOfStatement':
      case 'ForInStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'SwitchStatement':
      case 'TryStatement':
        taintEffects(node, env);
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const children = node[key];
          for (const child of Array.isArray(children) ? children : [children])
            if (child) walk(child, copyEnvironment(env));
        }
        break;
      default:
        read(node, env);
    }
  };
  const environment = new Map();
  environment.disabledPaths = new Set();
  walk(sourceCode.ast, environment);
  for (const item of functions) {
    // Deferred bodies have no fixed invocation time. Carry surrounding invalidations,
    // while resolving immutable scalar/API bindings even when declared later.
    for (const path of item.owner.disabledPaths) item.env.disabledPaths.add(path);
    for (const key of item.env.keys()) {
      if (key?.references?.some((ref) => ref.isWrite() && !ref.init)) continue;
      const value = item.owner.get(key);
      if (value && !isContainer(value) && !value.boundConfig) item.env.set(key, value);
    }
    walk(item.node.body, item.env);
  }
  const analysis = { calls, scope };
  analyses.set(sourceCode, analysis);
  return analysis;
};
