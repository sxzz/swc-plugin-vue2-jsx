export const rootAttributes = [
  'staticClass',
  'class',
  'style',
  'key',
  'ref',
  'refInFor',
  'slot',
  'scopedSlots',
  'model',
]
export const rootAttributesPrefix = [
  'props',
  'domProps',
  'on',
  'nativeOn',
  'hook',
  'attrs',
] as const

export const domPropsValueElements = ['input', 'textarea', 'option', 'select']
export const domPropsElements = [...domPropsValueElements, 'video']
