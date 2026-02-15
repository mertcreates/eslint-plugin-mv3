export const unwrapChain = (node) => (node?.type === 'ChainExpression' ? node.expression : node);

export const getStaticPropertyName = (node) => {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type === 'Literal') {
    return String(node.value);
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? null;
  }

  return null;
};

export const getObjectProperty = (objectExpression, propertyName) => {
  for (const prop of objectExpression.properties) {
    if (prop.type !== 'Property' || prop.computed) {
      continue;
    }

    if (getStaticPropertyName(prop.key) === propertyName) {
      return prop;
    }
  }

  return null;
};

export const isFunctionLike = (node) =>
  node?.type === 'FunctionExpression' ||
  node?.type === 'ArrowFunctionExpression' ||
  node?.type === 'FunctionDeclaration';

export const isTypeOnlyReference = (reference) =>
  reference?.isTypeReference === true && reference?.isValueReference === false;
