import { defineIteratorMethods, IteratorPrototype } from './iterator'
import Context from './context'
import { ContinueSentinel, doneResult, tryCatch } from './utils'
import * as $Symbol from './symbol'

const GenStateSuspendedStart = "suspendedStart";
const GenStateSuspendedYield = "suspendedYield";
const GenStateExecuting = "executing";
const GenStateCompleted = "completed";

// Dummy constructor functions that we use as the .constructor and
// .constructor.prototype properties for functions that return Generator
// objects. For full spec compliance, you may wish to configure your
// minifier not to mangle the names of these two functions.
function Generator() {}
function GeneratorFunction() {}
function GeneratorFunctionPrototype() {}

var Gp = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(IteratorPrototype);

GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
GeneratorFunctionPrototype.constructor = GeneratorFunction;
GeneratorFunctionPrototype[$Symbol.toStringTag] = GeneratorFunction.displayName = "GeneratorFunction";

// Define Generator.prototype.{next,throw,return} in terms of the
// unified ._invoke helper method.
/*#__PURE__*/ defineIteratorMethods(Gp);

Gp[$Symbol.toStringTag] = "Generator";

// A Generator should always return itself as the iterator object when the
// @@iterator function is called on it. Some browsers' implementations of the
// iterator prototype chain incorrectly implement this, causing the Generator
// object to not be returned from this call. This ensures that doesn't happen.
// See https://github.com/facebook/regenerator/issues/274 for more details.
Gp[$Symbol.iterator] = function() {
  return this;
};

Gp.toString = function() {
  return "[object Generator]";
};

export function isGeneratorFunction(genFun) {
  var ctor = typeof genFun === "function" && genFun.constructor;
  return ctor
    ? ctor === GeneratorFunction ||
      // For the native GeneratorFunction constructor, the best we can
      // do is to check its .name property.
      (ctor.displayName || ctor.name) === "GeneratorFunction"
    : false;
};

export function mark(genFun) {
  if (Object.setPrototypeOf) {
    Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
  } else {
    genFun.__proto__ = GeneratorFunctionPrototype;
    if (!($Symbol.toStringTag in genFun)) {
      genFun[$Symbol.toStringTag] = "GeneratorFunction";
    }
  }
  genFun.prototype = Object.create(Gp);
  return genFun;
};

export function wrap(innerFn, outerFn, self, tryLocsList) {
  // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
  var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
  var generator = Object.create(protoGenerator.prototype);
  var context = new Context(tryLocsList || []);

  // The ._invoke method unifies the implementations of the .next,
  // .throw, and .return methods.
  generator._invoke = makeInvokeMethod(innerFn, self, context);

  return generator;
}


function makeInvokeMethod(innerFn, self, context) {
  var state = GenStateSuspendedStart;

  return function invoke(method, arg) {
    if (state === GenStateExecuting) {
      throw new Error("Generator is already running");
    }

    if (state === GenStateCompleted) {
      if (method === "throw") {
        throw arg;
      }

      // Be forgiving, per 25.3.3.3.3 of the spec:
      // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
      return doneResult();
    }

    context.method = method;
    context.arg = arg;

    while (true) {
      var delegate = context.delegate;
      if (delegate) {
        var delegateResult = maybeInvokeDelegate(delegate, context);
        if (delegateResult) {
          if (delegateResult === ContinueSentinel) continue;
          return delegateResult;
        }
      }

      if (context.method === "next") {
        // Setting context._sent for legacy support of Babel's
        // function.sent implementation.
        context.sent = context._sent = context.arg;

      } else if (context.method === "throw") {
        if (state === GenStateSuspendedStart) {
          state = GenStateCompleted;
          throw context.arg;
        }

        context.dispatchException(context.arg);

      } else if (context.method === "return") {
        context.abrupt("return", context.arg);
      }

      state = GenStateExecuting;

      var record = tryCatch(innerFn, self, context);
      if (record.type === "normal") {
        // If an exception is thrown from innerFn, we leave state ===
        // GenStateExecuting and loop back for another invocation.
        state = context.done
          ? GenStateCompleted
          : GenStateSuspendedYield;

        if (record.arg === ContinueSentinel) {
          continue;
        }

        return {
          value: record.arg,
          done: context.done
        };

      } else if (record.type === "throw") {
        state = GenStateCompleted;
        // Dispatch the exception by looping back around to the
        // context.dispatchException(context.arg) call above.
        context.method = "throw";
        context.arg = record.arg;
      }
    }
  };
}

// Call delegate.iterator[context.method](context.arg) and handle the
// result, either by returning a { value, done } result from the
// delegate iterator, or by modifying context.method and context.arg,
// setting context.delegate to null, and returning the ContinueSentinel.
function maybeInvokeDelegate(delegate, context) {
  var method = delegate.iterator[context.method];
  if (method === undefined) {
    // A .throw or .return when the delegate iterator has no .throw
    // method always terminates the yield* loop.
    context.delegate = null;

    if (context.method === "throw") {
      if (delegate.iterator.return) {
        // If the delegate iterator has a return method, give it a
        // chance to clean up.
        context.method = "return";
        context.arg = undefined;
        maybeInvokeDelegate(delegate, context);

        if (context.method === "throw") {
          // If maybeInvokeDelegate(context) changed context.method from
          // "return" to "throw", let that override the TypeError below.
          return ContinueSentinel;
        }
      }

      context.method = "throw";
      context.arg = new TypeError(
        "The iterator does not provide a 'throw' method");
    }

    return ContinueSentinel;
  }

  var record = tryCatch(method, delegate.iterator, context.arg);

  if (record.type === "throw") {
    context.method = "throw";
    context.arg = record.arg;
    context.delegate = null;
    return ContinueSentinel;
  }

  var info = record.arg;

  if (! info) {
    context.method = "throw";
    context.arg = new TypeError("iterator result is not an object");
    context.delegate = null;
    return ContinueSentinel;
  }

  if (info.done) {
    // Assign the result of the finished delegate to the temporary
    // variable specified by delegate.resultName (see delegateYield).
    context[delegate.resultName] = info.value;

    // Resume execution at the desired location (see delegateYield).
    context.next = delegate.nextLoc;

    // If context.method was "throw" but the delegate handled the
    // exception, let the outer generator proceed normally. If
    // context.method was "next", forget context.arg since it has been
    // "consumed" by the delegate iterator. If context.method was
    // "return", allow the original .return call to continue in the
    // outer generator.
    if (context.method !== "return") {
      context.method = "next";
      context.arg = undefined;
    }

  } else {
    // Re-yield the result returned by the delegate method.
    return info;
  }

  // The delegate iterator is finished, so forget it and continue with
  // the outer generator.
  context.delegate = null;
  return ContinueSentinel;
}
