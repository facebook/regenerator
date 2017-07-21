import * as $Symbol from './symbol'
import { doneResult, hasOwn } from './utils'

export default function values(iterable) {
  if (iterable) {
    var iteratorMethod = iterable[$Symbol.iterator];
    if (iteratorMethod) {
      return iteratorMethod.call(iterable);
    }

    if (typeof iterable.next === "function") {
      return iterable;
    }

    if (!isNaN(iterable.length)) {
      var i = -1, next = function next() {
        while (++i < iterable.length) {
          if (hasOwn.call(iterable, i)) {
            next.value = iterable[i];
            next.done = false;
            return next;
          }
        }

        next.value = undefined;
        next.done = true;

        return next;
      };

      return next.next = next;
    }
  }

  // Return an iterator with no values.
  return { next: doneResult };
}
