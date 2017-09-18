import * as $Symbol from './symbol'
import { hasOwn, ObjectPrototype } from './utils'
import values from './values'

// This is a polyfill for %IteratorPrototype% for environments that
// don't natively support it.
const IteratorPrototypePolyfill = {
	[$Symbol.iterator]: function() {
		return this;
	}
};

const getProto = Object.getPrototypeOf;
const NativeIteratorPrototype = getProto && getProto(getProto(values([])));

export const IteratorPrototype =
	NativeIteratorPrototype &&
    NativeIteratorPrototype !== ObjectPrototype &&
    hasOwn.call(NativeIteratorPrototype, $Symbol.iterator) ? NativeIteratorPrototype : IteratorPrototypePolyfill

// Helper for defining the .next, .throw, and .return methods of the
// Iterator interface in terms of a single ._invoke method.
export function defineIteratorMethods(prototype) {
  ["next", "throw", "return"].forEach(function(method) {
    prototype[method] = function(arg) {
      return this._invoke(method, arg);
    };
  });
}
