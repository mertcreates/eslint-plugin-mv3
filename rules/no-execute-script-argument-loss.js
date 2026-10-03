import { getInjectionAnalysis, property, isUndefined, isAbsentOption, arrayItems } from '../lib/injection-analysis.js';
import { optionProblems } from './valid-execute-script-options.js';

const segment = (key, array) =>
  array ? `[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;

export default {
  meta: {
    type: 'problem',
    docs: {
      url: 'https://github.com/mertcreates/eslint-plugin-mv3#no-execute-script-argument-loss',
      description: 'Catch proven argument rejection and data loss in Chrome and Firefox MV3 injections.',
    },
    schema: [],
    messages: {
      rejected: '{{path}} contains BigInt: Chrome and Firefox reject this argument.',
      cycle: '{{path}} forms a cycle: Firefox rejects it; Chrome loses the circular reference.',
      bigintField: '{{path}} contains BigInt: Firefox rejects the argument; Chrome omits this field.',
      bigintElement: '{{path}} contains BigInt: Firefox rejects the argument; Chrome converts this element to null.',
      topLevelLoss: '{{path}} contains {{type}}: Chrome rejects this argument; Firefox converts it to null.',
      omitted: '{{path}} contains {{type}}: Chrome and Firefox omit this object field.',
      nullValue: '{{path}} contains {{type}}: Chrome and Firefox convert this array element to null.',
      nonFiniteField: '{{path}} contains {{type}}: Chrome omits this field; Firefox converts it to null.',
    },
  },
  create(context) {
    const analysis = getInjectionAnalysis(context);
    const cached = new WeakMap();
    const findings = (args) => {
      if (cached.has(args)) return cached.get(args);
      const results = [];
      const ancestors = new Set();
      const seen = new Set();
      const inspected = new Set();
      const serializerUncertainty = (value) => {
        if (!value || !['object', 'array'].includes(value.kind) || inspected.has(value)) return false;
        inspected.add(value);
        if (value.opaque || value.unknownKeys || !isUndefined(property(value, 'toJSON'))) return true;
        return [...value.properties.values()].some(serializerUncertainty);
      };
      if (serializerUncertainty(args)) {
        cached.set(args, results);
        return results;
      }
      const visit = (value, path, position) => {
        if (!value || value.kind === 'unknown' || value.opaque) return;
        const add = (messageId, type) =>
          results.push({
            node: value.node ?? args.node,
            messageId,
            data: { path, type },
          });
        const nonFinite =
          value.kind === 'primitive' && typeof value.value === 'number' && !Number.isFinite(value.value);
        const type =
          value.kind === 'function'
            ? 'Function'
            : value.kind === 'symbol'
              ? 'Symbol'
              : isUndefined(value)
                ? 'undefined'
                : nonFinite
                  ? String(value.value)
                  : null;
        if (value.kind === 'primitive' && typeof value.value === 'bigint') {
          add(position === 'argument' ? 'rejected' : position === 'array' ? 'bigintElement' : 'bigintField', 'BigInt');
          return;
        }
        if (type) {
          add(
            position === 'argument'
              ? 'topLevelLoss'
              : position === 'array'
                ? 'nullValue'
                : nonFinite
                  ? 'nonFiniteField'
                  : 'omitted',
            type
          );
          return;
        }
        if (!['object', 'array'].includes(value.kind)) return;
        // A custom serializer or an unknown key can change the entire value.
        const serializer = property(value, 'toJSON');
        if (!isUndefined(serializer) || value.unknownKeys) return;
        if (ancestors.has(value)) {
          add('cycle', 'cycle');
          return;
        }
        if (seen.has(value)) return;
        seen.add(value);
        ancestors.add(value);
        for (const [key, child] of value.kind === 'array' ? arrayItems(value) : value.properties) {
          visit(child, path + segment(key, value.kind === 'array'), value.kind === 'array' ? 'array' : 'object');
        }
        ancestors.delete(value);
      };
      for (const [key, value] of arrayItems(args)) visit(value, `args[${key}]`, 'argument');
      cached.set(args, results);
      return results;
    };
    return {
      CallExpression(node) {
        const call = analysis.calls.get(node);
        if (!call || optionProblems(call.config).length) return;
        const func = property(call.config, 'func');
        const args = property(call.config, 'args');
        if (
          func.kind !== 'function' ||
          !isAbsentOption(property(call.config, 'files')) ||
          args.kind !== 'array' ||
          args.opaque ||
          args.unknownKeys
        )
          return;
        for (const finding of findings(args)) context.report({ ...finding, node: finding.node ?? node });
      },
    };
  },
};
