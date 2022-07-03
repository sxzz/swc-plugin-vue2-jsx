import { transform } from '@swc/core'
import { transformVueJsx } from '../src'

export const transformJsx = async (code: string) => {
  return (
    await transform(code, {
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'ecmascript',
          jsx: true,
        },
      },
      plugin: (m) => transformVueJsx(m),
    })
  ).code
}
