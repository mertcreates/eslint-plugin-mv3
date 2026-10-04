import { getInjectionAnalysis, property } from '../lib/injection-analysis.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      url: 'https://github.com/mertcreates/eslint-plugin-mv3#no-main-world',
      description: 'Enforce a project policy against statically known MAIN-world injection.',
    },
    schema: [],
    messages: {
      mainWorld:
        'world: "MAIN" runs in the page JavaScript environment and violates this project policy. Omit world or set it to "ISOLATED".',
    },
  },
  create(context) {
    const analysis = getInjectionAnalysis(context);
    return {
      CallExpression(node) {
        const call = analysis.calls.get(node);
        if (!call) return;
        const world = property(call.config, 'world');
        if (world.kind === 'primitive' && world.value === 'MAIN')
          context.report({ node: world.node ?? call.config.node ?? node, messageId: 'mainWorld' });
      },
    };
  },
};
