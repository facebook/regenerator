export { isGeneratorFunction, mark, wrap } from './generator'
export { default as AsyncIterator } from './asyncIterator'
export { default as async } from './async'
export { default as keys } from './keys'
export { default as values } from './values'

// Within the body of any async function, `await x` is transformed to
// `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
// `hasOwn.call(value, "__await")` to determine if the yielded value is
// meant to be awaited.
export const awrap = arg => ({ __await: arg });
