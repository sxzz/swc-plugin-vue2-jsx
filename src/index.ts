import { Visitor } from '@swc/core/Visitor.js'
import { rootAttributes } from './constants'
import type {
  Argument,
  CallExpression,
  Expression,
  JSXAttribute,
  JSXElement,
  JSXElementChild,
  JSXExpressionContainer,
  JSXOpeningElement,
  KeyValueProperty,
  Node,
  ObjectExpression,
  Program,
  StringLiteral,
} from '@swc/core'

function notSupported(n: Node): never {
  throw new Error(`${n.type} is not supported`)
}

/** Converts expressions to arguments */
function expressionsToArguments(arr: Expression[]) {
  return arr.map((item): Argument => ({ expression: item }))
}

function transformJsxExpressionContainer(
  n: JSXExpressionContainer
): Expression | undefined {
  if (n.expression.type === 'JSXEmptyExpression') {
    return undefined
  }
  return n.expression
}

function transformTagName(n: JSXOpeningElement): StringLiteral {
  switch (n.name.type) {
    case 'Identifier':
      return {
        type: 'StringLiteral',
        value: n.name.value,
        hasEscape: false,
        span: n.span,
      }
    // <A.B>
    // TODO
    case 'JSXMemberExpression':
    default:
      notSupported(n)
  }
}

function transformJsxAttribute(n: JSXAttribute): [KeyValueProperty, string] {
  if (n.name.type === 'JSXNamespacedName') {
    // TODO
    return notSupported(n)
  }

  const attrValue = n.value
  let value: Expression | undefined
  if (attrValue?.type.startsWith('JSX')) {
    if (attrValue?.type === 'JSXExpressionContainer') {
      value = transformJsxExpressionContainer(attrValue)
    } else {
      return notSupported(attrValue)
    }
  } else {
    value = attrValue as any
  }

  if (!value)
    value = {
      type: 'BooleanLiteral',
      value: true,
      span: n.span,
    }

  return [
    {
      type: 'KeyValueProperty',
      key: n.name,
      value,
    },
    n.name.value,
  ]
}

function transformJsxAttributes(
  opening: JSXOpeningElement
): ObjectExpression | undefined {
  if (!opening.attributes) return

  const attrs: KeyValueProperty[] = []
  const properties: KeyValueProperty[] = []

  for (const attribute of opening.attributes) {
    switch (attribute.type) {
      case 'JSXAttribute': {
        const [kv, key] = transformJsxAttribute(attribute)
        if (rootAttributes.includes(key)) {
          properties.push(kv)
        } else {
          attrs.push(kv)
        }
        break
      }
      default:
        return notSupported(attribute)
    }
  }
  if (attrs.length > 0) {
    properties.push({
      type: 'KeyValueProperty',
      key: {
        type: 'Identifier',
        value: 'attrs',
        span: opening.span,
        optional: false,
      },
      value: {
        type: 'ObjectExpression',
        properties: attrs,
        span: opening.span,
      },
    })
  }
  if (properties.length === 0) {
    return undefined
  }

  const n: ObjectExpression = {
    type: 'ObjectExpression',
    properties,
    span: opening.span,
  }

  // return {
  //   type: 'ObjectExpression',
  //   properties,
  //   span: nodes[0],
  // }

  return n
}

function transformJsx(n: JSXElementChild): Expression | undefined {
  switch (n.type) {
    case 'JSXElement':
      return transformJSXElement(n)
    case 'JSXExpressionContainer':
      return transformJsxExpressionContainer(n)
    case 'JSXFragment':
      return notSupported(n)
    case 'JSXSpreadChild':
      return n.expression
    case 'JSXText':
      return {
        type: 'StringLiteral',
        value: n.value,
        span: n.span,
        hasEscape: false,
      }
  }
}

/** Transform JSXElement to h() calls */
const transformJSXElement = (n: JSXElement): CallExpression => {
  const tag = transformTagName(n.opening)

  const args: Expression[] = [tag]

  // attrs
  const attrs = transformJsxAttributes(n.opening)
  if (attrs) args.push(attrs)

  // children
  const children = n.children.map((child) => transformJsx(child))
  args.push({
    type: 'ArrayExpression',
    elements: children.map((child) =>
      child ? { expression: child } : undefined
    ),
    span: n.span,
  })

  return {
    type: 'CallExpression',
    arguments: expressionsToArguments(args),
    callee: {
      type: 'Identifier',
      value: 'h',
      optional: false,
      span: n.span,
    },
    span: n.span,
  }
}

class JsxTransformer extends Visitor {
  visitJSXElement(n: JSXElement): any {
    return transformJSXElement(n)
  }
}

export const transformVueJsx = (program: Program) => {
  return new JsxTransformer().visitProgram(program)
}
