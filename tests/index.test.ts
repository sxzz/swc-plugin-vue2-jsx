import { describe, expect, test } from 'vitest'
import { transformJsx } from './_util'

describe('transform', () => {
  test('basic', async () => {
    expect(
      await transformJsx(`const vnode = <div><p>123</p></div>`)
    ).toMatchSnapshot()
  })

  test('attributes', async () => {
    expect(
      await transformJsx(`const vnode = <div a="b" ref="ref1"><p>123</p></div>`)
    ).toMatchSnapshot()
  })

  test('attributes w/ expression', async () => {
    expect(
      await transformJsx(`const vnode = <div a={1 + 2}></div>`)
    ).toMatchSnapshot()
  })
})
