import AsyncIterator from './asyncIterator'
import { isGeneratorFunction, wrap } from './generator'

// Note that simple async functions are implemented on top of
// AsyncIterator objects; they just return a Promise for the value of
// the final result produced by the iterator.
export default function async(innerFn, outerFn, self, tryLocsList) {
  var iter = new AsyncIterator(
    wrap(innerFn, outerFn, self, tryLocsList)
  );

  return isGeneratorFunction(outerFn)
    ? iter // If outerFn is a generator, return the full iterator.
    : iter.next().then(function(result) {
        return result.done ? result.value : iter.next();
      });
};
