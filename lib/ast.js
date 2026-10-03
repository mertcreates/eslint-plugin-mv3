export const unwrapChain = (node) => (node?.type === 'ChainExpression' ? node.expression : node);

export const isTypeOnlyReference = (reference) =>
  reference?.isTypeReference === true && reference?.isValueReference === false;
