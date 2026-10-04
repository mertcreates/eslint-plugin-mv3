import { getInjectionAnalysis, property, isUndefined, isAbsentOption, arrayItems } from '../lib/injection-analysis.js';

const known = (value) => value.kind !== 'unknown';
const active = (value) => known(value) && !isAbsentOption(value);
const object = (value) => value.kind === 'object' && !value.opaque;
const integer = (value) => value.kind === 'primitive' && Number.isInteger(value.value);

// Both rules use the same contract checks, so invalid options suppress payload diagnostics.
export const optionProblems = (options) => {
  const problems = [];
  const add = (messageId, value, field) =>
    problems.push({
      messageId,
      node: value.node ?? options.node,
      data: { field },
    });
  if (!object(options)) {
    if (known(options) && !options.opaque) add('invalidType', options, 'options (object)');
    return problems;
  }
  const func = property(options, 'func');
  const files = property(options, 'files');
  const args = property(options, 'args');
  if (active(func) && active(files)) add('exclusiveSource', options, 'func/files');
  else if (isAbsentOption(func) && isAbsentOption(files)) add('missingSource', options, 'func/files');
  if (active(args) && (active(files) || isAbsentOption(func))) add('argsWithoutFunc', args, 'args');
  if (active(func) && func.kind !== 'function') add('invalidType', func, 'func (function)');
  if (active(func) && func.kind === 'function' && func.methodSyntax)
    problems.push({
      messageId: 'methodFunction',
      node: func.methodNode ?? func.node ?? options.node,
    });
  else if (active(func) && func.kind === 'function' && func.generator)
    problems.push({
      messageId: 'generatorFunction',
      node: func.node ?? options.node,
    });
  if (active(files) && files.kind !== 'array') add('invalidType', files, 'files (array)');
  if (active(args) && args.kind !== 'array') add('invalidType', args, 'args (array)');
  if (files.kind === 'array' && !files.opaque) {
    for (const [, value] of arrayItems(files)) {
      if (known(value) && (value.kind !== 'primitive' || typeof value.value !== 'string'))
        add('invalidType', value, 'files[] (string)');
    }
  }
  const immediately = property(options, 'injectImmediately');
  if (active(immediately) && (immediately.kind !== 'primitive' || typeof immediately.value !== 'boolean')) {
    add('invalidType', immediately, 'injectImmediately (boolean)');
  }
  const world = property(options, 'world');
  if (active(world) && (world.kind !== 'primitive' || !['ISOLATED', 'MAIN'].includes(world.value)))
    add('invalidWorld', world, 'world');
  const target = property(options, 'target');
  if (isUndefined(target)) add('missingTarget', options, 'target');
  else if (known(target) && !object(target) && !target.opaque) add('invalidType', target, 'target (object)');
  if (!object(target)) return problems;
  const tabId = property(target, 'tabId');
  if (isUndefined(tabId)) add('missingTabId', target, 'target.tabId');
  else if (known(tabId) && !integer(tabId)) add('invalidType', tabId, 'target.tabId (integer)');
  const allFrames = property(target, 'allFrames');
  if (active(allFrames) && (allFrames.kind !== 'primitive' || typeof allFrames.value !== 'boolean'))
    add('invalidType', allFrames, 'target.allFrames (boolean)');
  const frames = property(target, 'frameIds');
  const documents = property(target, 'documentIds');
  for (const [field, value, valid] of [
    ['frameIds', frames, integer],
    ['documentIds', documents, (item) => item.kind === 'primitive' && typeof item.value === 'string'],
  ]) {
    if (active(value) && value.kind !== 'array') add('invalidType', value, `target.${field} (array)`);
    else if (value.kind === 'array' && !value.opaque) {
      for (const [, item] of arrayItems(value))
        if (known(item) && !valid(item)) add('invalidType', item, `target.${field}[]`);
    }
  }
  if (allFrames.kind === 'primitive' && allFrames.value === true && active(frames))
    add('frameConflict', frames, 'allFrames/frameIds');
  if (active(documents) && active(frames)) add('documentConflict', documents, 'documentIds/frameIds');
  return problems;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      url: 'https://github.com/mertcreates/eslint-plugin-mv3#valid-execute-script-options',
      description: 'Check statically known MV3 script injection options.',
    },
    schema: [],
    messages: {
      exclusiveSource: 'Choose exactly one of func and files.',
      missingSource: 'Provide func or files.',
      argsWithoutFunc: 'args requires func and cannot accompany files.',
      missingTarget: 'Provide target with a tabId.',
      missingTabId: 'Provide target.tabId.',
      invalidType: '{{field}} has an invalid value type.',
      invalidWorld: 'world must be ISOLATED or MAIN.',
      methodFunction:
        'Method-syntax functions cannot be reconstructed as standalone injected functions. Use a function declaration, function expression, or arrow function.',
      generatorFunction:
        'executeScript calls this generator function but does not advance its iterator, so the generator body does not run. Use a regular function and advance the iterator there if needed.',
      frameConflict: 'allFrames: true cannot accompany frameIds.',
      documentConflict: 'documentIds cannot accompany frameIds.',
    },
  },
  create(context) {
    const analysis = getInjectionAnalysis(context);
    return {
      CallExpression(node) {
        const call = analysis.calls.get(node);
        if (call)
          for (const problem of optionProblems(call.config)) context.report({ ...problem, node: problem.node ?? node });
      },
    };
  },
};
