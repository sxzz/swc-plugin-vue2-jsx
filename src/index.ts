import { Visitor } from '@swc/core/Visitor.js'
import {
  domPropsValueElements,
  rootAttributes,
  rootAttributesPrefix,
} from './constants'
import type {
  Argument,
  CallExpression,
  ExprOrSpread,
  Expression,
  JSXAttribute,
  JSXElement,
  JSXElementChild,
  JSXExpressionContainer,
  JSXOpeningElement,
  JSXText,
  KeyValueProperty,
  MemberExpression,
  Module,
  Node,
  ObjectExpression,
  Program,
  StringLiteral,
} from '@swc/core'

const xlinkRE = /^xlink([A-Z])/

function notSupported(n: Node): never {
  throw new Error(`${n.type} is not supported`)
}

/**
 * Checks if attribute is "special" and needs to be used as domProps
 */
const mustUseDomProps = (tag: string, type: string, attributeName: string) => {
  return (
    (attributeName === 'value' &&
      domPropsValueElements.includes(tag) &&
      type !== 'button') ||
    (attributeName === 'selected' && tag === 'option') ||
    (attributeName === 'checked' && tag === 'input') ||
    (attributeName === 'muted' && tag === 'video')
  )
}

/** Converts expressions to arguments */
function wrapperExpressions(arr: Expression[]) {
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

/**
 * Transform JSXText to StringLiteral
 */
const transformJsxText = (n: JSXText): StringLiteral | undefined => {
  const lines = n.value.split(/\r\n|\n|\r/)

  let lastNonEmptyLine = 0

  for (const [i, line] of lines.entries()) {
    if (line.match(/[^\t ]/)) {
      lastNonEmptyLine = i
    }
  }

  let str = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const isFirstLine = i === 0
    const isLastLine = i === lines.length - 1
    const isLastNonEmptyLine = i === lastNonEmptyLine

    // replace rendered whitespace tabs with spaces
    let trimmedLine = line.replace(/\t/g, ' ')

    // trim whitespace touching a newline
    if (!isFirstLine) {
      trimmedLine = trimmedLine.replace(/^ +/, '')
    }

    // trim whitespace touching an endline
    if (!isLastLine) {
      trimmedLine = trimmedLine.replace(/ +$/, '')
    }

    if (trimmedLine) {
      if (!isLastNonEmptyLine) {
        trimmedLine += ' '
      }

      str += trimmedLine
    }
  }

  return str !== ''
    ? {
        type: 'StringLiteral',
        value: str,
        hasEscape: false,
        span: n.span,
      }
    : undefined
}

function transformTag(n: JSXOpeningElement): StringLiteral | MemberExpression {
  const { name } = n
  switch (name.type) {
    case 'Identifier':
      return {
        type: 'StringLiteral',
        value: name.value,
        hasEscape: false,
        span: n.span,
      }
    case 'JSXMemberExpression':
      return {
        type: 'MemberExpression',
        object: name.object,
        property: name.property,
        span: n.span,
      }
    default:
      notSupported(n)
  }
}

function transformJsxAttribute(n: JSXAttribute): [string, Expression] {
  if (n.name.type === 'JSXNamespacedName') {
    // TODO
    return notSupported(n.name)
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

  return [n.name.value, value]
}

function last<T>(arr: T[]): T | undefined {
  return arr?.[arr.length - 1]
}

function transformAttributeKey(
  attributes: Record<string, Expression[]>,
  key: string,
  tagName: string | undefined
): [typeof rootAttributesPrefix[number], string] {
  let prefix = rootAttributesPrefix.find((prefix) => key.startsWith(prefix))
  let name: string
  if (prefix) {
    name = key
      .slice(prefix.length)
      .replace(/^-/, '')
      .replace(/^[A-Z]/, (s) => s.toLowerCase())
  } else {
    prefix = 'attrs'
    name = key
  }

  if (tagName) {
    const typeValue = last(attributes.type)
    const elementType = typeValue?.type === 'StringLiteral' && typeValue.value
    if (mustUseDomProps(tagName, elementType || '', name)) {
      prefix = 'domProps'
    }
  }

  if (xlinkRE.test(name)) {
    name = name.replace(xlinkRE, (_, firstCharacter) => {
      return `xlink:${firstCharacter.toLowerCase()}`
    })
  }

  return [prefix, name]
}

function transformAttributeValue(
  prefix: string,
  opening: JSXOpeningElement,
  values: Expression[]
): Expression[] {
  if (prefix === 'on' && values.length > 1) {
    return [
      {
        type: 'ArrayExpression',
        elements: wrapperExpressions(values),
        span: opening.span,
      },
    ]
  } else {
    return values
  }
}

function transformJsxAttributes(
  opening: JSXOpeningElement,
  attrs: JSXAttribute[],
  tagName: string | undefined
): ObjectExpression | undefined {
  if (!opening.attributes) return

  const attributes: Record<string, Expression[]> = {}
  for (const attr of attrs) {
    const [key, value] = transformJsxAttribute(attr)

    if (!attributes[key]) attributes[key] = []
    attributes[key].push(value)
  }

  const propertyMap: Partial<
    Record<typeof rootAttributesPrefix[number] | 'attrs', KeyValueProperty[]>
  > &
    // Root property
    Record<typeof rootAttributes[number], Expression> = {}

  for (const [key, values] of Object.entries(attributes)) {
    if (rootAttributes.includes(key)) {
      propertyMap[key] = last(values)!
    } else {
      const [prefix, name] = transformAttributeKey(attributes, key, tagName)
      if (!propertyMap[prefix]) propertyMap[prefix] = []

      const attrValues = transformAttributeValue(prefix, opening, values)

      propertyMap[prefix]!.push(
        ...attrValues.map(
          (value): KeyValueProperty => ({
            type: 'KeyValueProperty',
            key: {
              type: 'StringLiteral',
              value: name,
              span: opening.span,
              hasEscape: false,
            },
            value,
          })
        )
      )
    }
  }

  const properties = Object.entries(propertyMap).map(
    ([key, valueOrAttr]): KeyValueProperty => {
      if (Array.isArray(valueOrAttr)) {
        return {
          type: 'KeyValueProperty',
          key: {
            type: 'Identifier',
            value: key,
            span: opening.span,
            optional: false,
          },
          value: {
            type: 'ObjectExpression',
            properties: valueOrAttr,
            span: opening.span,
          },
        }
      } else {
        return {
          type: 'KeyValueProperty',
          key: {
            type: 'Identifier',
            value: key,
            span: opening.span,
            optional: false,
          },
          value: valueOrAttr,
        }
      }
    }
  )

  if (properties.length === 0) {
    return undefined
  }

  return {
    type: 'ObjectExpression',
    properties,
    span: opening.span,
  }
}

function isExprssion(n: any): n is Expression {
  return !!n.type
}

function toExprOrSpread(n: Expression | ExprOrSpread): ExprOrSpread {
  if (!n) return n
  if (isExprssion(n)) return { expression: n }
  else return n
}

export const transformVueJsx = (program: Program) => {
  let shouldInjectHelper = false

  function transformJsx(
    n: JSXElementChild
  ): Expression | ExprOrSpread | undefined {
    switch (n.type) {
      case 'JSXElement':
        return transformJSXElement(n)
      case 'JSXExpressionContainer':
        return transformJsxExpressionContainer(n)
      case 'JSXFragment':
        return notSupported(n)
      case 'JSXSpreadChild':
        return {
          expression: n.expression,
          spread: (n as any).span,
        }
      case 'JSXText':
        return transformJsxText(n)
    }
  }

  /** Transform JSXElement to h() calls */
  const transformJSXElement = (n: JSXElement): CallExpression => {
    const tag = transformTag(n.opening)
    const tagName = tag.type === 'StringLiteral' ? tag.value : undefined

    const args: Expression[] = [tag]

    // attrs
    if (n.opening.attributes) {
      const groupedAttrs: Array<JSXAttribute[] | Expression> = []
      for (const attr of n.opening.attributes ?? []) {
        let lastElement = last(groupedAttrs)
        if (!Array.isArray(lastElement)) {
          lastElement = []
          groupedAttrs.push(lastElement)
        }
        if (attr.type === 'SpreadElement') {
          groupedAttrs.push(attr.arguments)
        } else {
          lastElement.push(attr)
        }
      }
      const finalAttrs: Expression[] = []
      for (const attrs of groupedAttrs) {
        if (Array.isArray(attrs)) {
          const expr = transformJsxAttributes(n.opening, attrs, tagName)
          if (expr) finalAttrs.push(expr)
        } else {
          finalAttrs.push(attrs)
        }
      }

      if (finalAttrs.length === 1) {
        args.push(finalAttrs[0])
      } else if (finalAttrs.length > 1) {
        shouldInjectHelper = true
        args.push({
          type: 'CallExpression',
          callee: {
            type: 'Identifier',
            value: '_mergeJSXProps',
            optional: false,
            span: n.span,
          },
          arguments: wrapperExpressions([
            {
              type: 'ArrayExpression',
              elements: wrapperExpressions(finalAttrs),
              span: n.span,
            },
          ]),
          span: n.span,
        })
      }
    }

    // children
    const children = n.children
      .map((child) => transformJsx(child))
      .filter((c): c is Expression | ExprOrSpread => !!c)
    if (children.length > 0)
      args.push({
        type: 'ArrayExpression',
        elements: children.map((child) => toExprOrSpread(child)),
        span: n.span,
      })

    return {
      type: 'CallExpression',
      arguments: wrapperExpressions(args),
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
      const expression = transformJSXElement(n)
      return expression
    }
  }

  program = new JsxTransformer().visitProgram(program)

  if (shouldInjectHelper) {
    const span = { start: 0, end: 0, ctxt: 0 }
    ;(program as Module).body.unshift({
      type: 'ImportDeclaration',
      specifiers: [
        {
          type: 'ImportDefaultSpecifier',
          local: {
            type: 'Identifier',
            value: '_mergeJSXProps',
            optional: false,
            span,
          },
          span,
        },
      ],
      source: {
        type: 'StringLiteral',
        value: '@vue/babel-helper-vue-jsx-merge-props',
        hasEscape: false,
        span,
      },
      typeOnly: false,
      span,
    })
  }
  return program
}
