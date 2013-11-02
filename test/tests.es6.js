/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

var assert = require("assert");
require("../runtime/dev");

function check(g, yields, returnValue) {
  for (var i = 0; i < yields.length; ++i) {
    var info = g.next(i);
    assert.deepEqual(info.value, yields[i]);
    assert.strictEqual(info.done, false);
  }

  assert.deepEqual(g.next(i), {
    value: returnValue,
    done: true
  });
}

// A version of `throw` whose behavior can't be statically analyzed.
// Useful for testing dynamic exception dispatching.
function raise(argument) {
  throw argument;
}

describe("wrapGenerator", function() {
  it("should be defined globally", function() {
    var global = Function("return this")();
    assert.ok("wrapGenerator" in global);
    assert.strictEqual(global.wrapGenerator, wrapGenerator);
  });

  it("should be a function", function() {
    assert.strictEqual(typeof wrapGenerator, "function");
  });
});

describe("simple argument yielder", function() {
  it("should yield only its first argument", function() {
    function *gen(x) {
      yield x;
    }

    check(gen("oyez"), ["oyez"]);
    check(gen("foo", "bar"), ["foo"]);
  });

  it("should support multiple yields in expression", function() {
    function *gen() { return (yield 0) + (yield 0); }
    var itr = gen();
    itr.next();
    itr.next(1);
    assert.equal(itr.next(2).value, 3);
  });
});

describe("range generator", function() {
  function *range(n) {
    for (var i = 0; i < n; ++i) {
      yield i;
    }
  }

  it("should yield the empty range", function() {
    check(range(0), []);
  })

  it("should yield the range 0..n-1", function() {
    check(range(5), [0, 1, 2, 3, 4]);
  });
});

describe("collatz generator", function() {
  function *gen(n) {
    var count = 0;

    yield n;

    while (n !== 1) {
      count += 1;

      if (n % 2) {
        yield n = n * 3 + 1;
      } else {
        yield n >>= 1;
      }
    }

    return count;
  }

  function collatz(n) {
    var result = [n];

    while (n !== 1) {
      if (n % 2) {
        n *= 3;
        n += 1;
      } else {
        n >>= 1;
      }

      result.push(n);
    }

    return result;
  }

  var seven = collatz(7);
  var fiftyTwo = seven.slice(seven.indexOf(52));
  var eightyTwo = collatz(82);

  it("seven", function() {
    check(gen(7), seven, 16);
  });

  it("fifty two", function() {
    check(gen(52), fiftyTwo, 11);
  });

  it("eighty two", function() {
    check(gen(82), eightyTwo, 110);
  });
});

describe("try-catch generator", function() {
  function *usingThrow(x) {
    yield 0;
    try {
      yield 1;
      if (x % 2 === 0)
        throw 2;
      yield x;
    } catch (x) {
      yield x;
    }
    yield 3;
  }

  function *usingRaise(x) {
    yield 0;
    try {
      yield 1;
      if (x % 2 === 0)
        raise(2);
      yield x;
    } catch (x) {
      yield x;
    }
    yield 3;
  }

  it("should catch static exceptions properly", function() {
    check(usingThrow(4), [0, 1, 2, 3]);
    check(usingThrow(5), [0, 1, 5, 3]);
  });

  it("should catch dynamic exceptions properly", function() {
    check(usingRaise(4), [0, 1, 2, 3]);
    check(usingRaise(5), [0, 1, 5, 3]);
  });
});

describe("try-finally generator", function() {
  function *usingThrow(condition) {
    yield 0;
    try {
      yield 1;
      throw 2;
      yield 3;
    } finally {
      if (condition) {
        yield 4;
        return 5;
      }
      yield 6;
      return 7;
    }
  }

  function *usingRaise(condition) {
    yield 0;
    try {
      yield 1;
      raise(2);
      yield 3;
    } finally {
      if (condition) {
        yield 4;
        return 5;
      }
      yield 6;
      return 7;
    }
  }

  it("should execute finally blocks statically", function() {
    check(usingThrow(true), [0, 1, 4], 5);
    check(usingThrow(false), [0, 1, 6], 7);
  });

  it("should execute finally blocks dynamically", function() {
    check(usingRaise(true), [0, 1, 4], 5);
    check(usingRaise(false), [0, 1, 6], 7);
  });

  it("should execute finally blocks before throwing", function() {
    var uncaughtError = new Error("uncaught");

    function *uncaught(condition) {
      try {
        yield 0;
        if (condition) {
          yield 1;
          raise(uncaughtError);
        }
        yield 2;
      } finally {
        yield 3;
      }
      yield 4;
    }

    check(uncaught(false), [0, 2, 3, 4]);

    var u = uncaught(true);

    assert.deepEqual(u.next(), { value: 0, done: false });
    assert.deepEqual(u.next(), { value: 1, done: false });
    assert.deepEqual(u.next(), { value: 3, done: false });

    try {
      u.next();
      assert.ok(false, "should have thrown an exception");
    } catch (err) {
      assert.strictEqual(err, uncaughtError);
    }
  });
});

describe("try-catch-finally generator", function() {
  function *usingThrow() {
    yield 0;
    try {
      try {
        yield 1;
        throw 2;
        yield 3;
      } catch (x) {
        throw yield x;
      } finally {
        yield 5;
      }
    } catch (thrown) {
      yield thrown;
    }
    yield 6;
  }

  function *usingRaise() {
    yield 0;
    try {
      try {
        yield 1;
        raise(2);
        yield 3;
      } catch (x) {
        throw yield x;
      } finally {
        yield 5;
      }
    } catch (thrown) {
      yield thrown;
    }
    yield 6;
  }

  it("should statically catch and then finalize", function() {
    check(usingThrow(), [0, 1, 2, 5, 3, 6]);
  });

  it("should dynamically catch and then finalize", function() {
    check(usingRaise(), [0, 1, 2, 5, 3, 6]);
  });
});

describe("dynamic exception", function() {
  function *gen(x, fname) {
    try {
      return fns[fname](x);
    } catch (thrown) {
      yield thrown;
    }
  }

  var fns = {
    f: function(x) {
      throw x;
    },

    g: function(x) {
      return x;
    }
  };

  it("should be dispatched correctly", function() {
    check(gen("asdf", "f"), ["asdf"]);
    check(gen("asdf", "g"), [], "asdf");
  });
});

describe("nested finally blocks", function() {
  function *usingThrow() {
    try {
      try {
        try {
          throw "thrown";
        } finally {
          yield 1;
        }
      } catch (thrown) {
        yield thrown;
      } finally {
        yield 2;
      }
    } finally {
      yield 3;
    }
  }

  function *usingRaise() {
    try {
      try {
        try {
          raise("thrown");
        } finally {
          yield 1;
        }
      } catch (thrown) {
        yield thrown;
      } finally {
        yield 2;
      }
    } finally {
      yield 3;
    }
  }

  it("should statically execute in order", function() {
    check(usingThrow(), [1, "thrown", 2, 3]);
  });

  it("should dynamically execute in order", function() {
    check(usingRaise(), [1, "thrown", 2, 3]);
  });
});

describe("for-in loop generator", function() {
  function *gen(obj) {
    var count = 0;
    for (var key in (yield "why not", obj)) {
      if (obj.hasOwnProperty(key)) {
        if (key === "skip") {
          break;
        }
        count += 1;
        yield [key, obj[key]];
      }
    }
    return count;
  }

  it("should visit properties until 'skip'", function() {
    check(
      gen({ a: 1, b: 2, skip: 3, c: 4 }),
      ["why not", ["a", 1], ["b", 2]], 2);
  });
});

describe("yield chain", function() {
  function *gen(n) {
    return yield yield yield yield n;
  }

  it("should have correct associativity", function() {
    check(gen(5), [5, 1, 2, 3], 4);
    check(gen("asdf"), ["asdf", 1, 2, 3], 4);
  });
});

describe("object literal generator", function() {
  function *gen(a, b) {
    yield {
      a: a - (yield a),
      b: yield b
    };
  }

  it("should yield the correct object", function() {
    check(gen(1, 2), [1, 2, { a: 0, b: 2 }]);
    check(gen(4, 2), [4, 2, { a: 3, b: 2 }]);
  });
});

describe("switch statement generator", function() {
  function *gen(a) {
    switch (yield a) {
    case (yield "x") - a:
      return "first case";
    case (yield "y") - a:
      return "second case";
    }
  }

  it("should jump to the correct cases", function() {
    check(gen(1), [1, "x"], "first case");
    check(gen(2), [2, "x", "y"], "second case");
  });
});

describe("infinite sequence generator", function() {
  function *gen(start, step) {
    step = step || 1;
    while (true) {
      yield start;
      start += step;
    }
  }

  function *limit(g, stop) {
    while (true) {
      var info = g.next();
      if (info.done) {
        return;
      } else if (info.value < stop) {
        yield info.value;
      } else {
        return;
      }
    }
  }

  it("should generate a lot of plausible values", function() {
    var g = gen(10, 2);

    assert.deepEqual(g.next(), { value: 10, done: false });
    assert.deepEqual(g.next(), { value: 12, done: false });
    assert.deepEqual(g.next(), { value: 14, done: false });
    assert.deepEqual(g.next(), { value: 16, done: false });

    var sum = 10 + 12 + 14 + 16;

    for (var n = 0; n < 1000; ++n) {
      var info = g.next();
      sum += info.value;
      assert.strictEqual(info.done, false);
    }

    assert.strictEqual(sum, 1017052);
  });

  it("should allow limiting", function() {
    check(limit(gen(10, 3), 20), [10, 13, 16, 19]);
  });
});

describe("generator function expression", function() {
  it("should behave just like a declared generator", function() {
    check(function *(x, y) {
      yield x;
      yield y;
      yield x + y;
      return x * y;
    }(3, 7), [3, 7, 10], 21);
  })
});

describe("generator reentry attempt", function() {
  function *gen(x) {
    try {
      (yield x).next(x);
    } catch (err) {
      yield err;
    }
    return x + 1;
  }

  it("should complain with a TypeError", function() {
    var g = gen(3);
    assert.deepEqual(g.next(), { value: 3, done: false });
    var complaint = g.next(g); // Sending the generator to itself.
    assert.ok(complaint.value instanceof Error);
    assert.strictEqual(
      complaint.value.message,
      "Generator is already running"
    );
    assert.deepEqual(g.next(), { value: 4, done: true });
  });
});

describe("completed generator", function() {
  function *gen() {
    return "ALL DONE";
  }

  it("should refuse to resume", function() {
    var g = gen();

    assert.deepEqual(g.next(), {
      value: "ALL DONE", done: true
    });

    try {
      g.next();
      assert.ok(false, "should have thrown an exception");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(
        err.message,
        "Generator has already finished"
      );
    }
  });
});

describe("delegated yield", function() {
  it("should delegate correctly", function() {
    function *gen(condition) {
      yield 0;
      if (condition) {
        yield 1;
        yield* gen(false);
        yield 2;
      }
      yield 3;
    }

    check(gen(true), [0, 1, 0, 3, 2, 3]);
    check(gen(false), [0, 3]);
  });

  it("should cope with empty delegatees", function() {
    function *gen(condition) {
      if (condition) {
        yield 0;
        yield* gen(false);
        yield 1;
      }
    }

    check(gen(true), [0, 1]);
    check(gen(false), []);
  });

  it("should support deeper nesting", function() {
    function *outer(n) {
      yield n;
      yield* middle(n - 1, inner(n + 10));
      yield n + 1;
    }

    function *middle(n, plusTen) {
      yield n;
      yield* inner(n - 1);
      yield n + 1;
      yield* plusTen;
    }

    function *inner(n) {
      yield n;
    }

    check(outer(5), [5, 4, 3, 5, 15, 6]);
  });

  it("should pass sent values through", function() {
    function *outer(n) {
      yield* inner(n << 1);
      yield "zxcv";
    }

    function *inner(n) {
      return yield yield yield n;
    }

    var g = outer(3);
    assert.deepEqual(g.next(), { value: 6, done: false });
    assert.deepEqual(g.next(1), { value: 1, done: false });
    assert.deepEqual(g.next(2), { value: 2, done: false });
    assert.deepEqual(g.next(4), { value: "zxcv", done: false });
    assert.deepEqual(g.next(5), { value: void 0, done: true });
  });

  it("should be governed by enclosing try statements", function() {
    var error = new Error("thrown");

    function *outer(n) {
      try {
        yield 0;
        yield* inner(n);
        yield 1;
      } catch (err) {
        yield err.message;
      }
      yield 4;
    }

    function *inner(n) {
      while (n --> 0) {
        try {
          if (n === 3) {
            raise(error);
          }
        } finally {
          yield n;
        }
      }
    }

    check(outer(3), [0, 2, 1, 0, 1, 4]);
    check(outer(5), [0, 4, 3, "thrown", 4]);
  });
});

describe("function declaration hoisting", function() {
  it("should work even if the declarations are out of order", function() {
    function *gen(n) {
      yield increment(n);

      function increment(x) {
        return x + 1;
      }

      if (n % 2) {
        yield halve(decrement(n));

        function halve(x) {
          return x >> 1;
        }

        function decrement(x) {
          return x - 1;
        }
      } else {
        // The behavior of function declarations nested inside conditional
        // blocks is notoriously underspecified, and in V8 it appears the
        // halve function is still defined when we take this branch, so
        // "undefine" it for consistency with regenerator semantics.
        halve = void 0;
      }

      yield typeof halve;

      yield increment(increment(n));
    }

    check(gen(3), [4, 1, "function", 5]);
    check(gen(4), [5, "undefined", 6]);
  });
});

describe("the arguments object", function() {
  it("should work in simple variadic functions", function() {
    function *sum() {
      var result = 0;

      for (var i = 0; i < arguments.length; ++i) {
        yield result += arguments[i];
      }

      return result;
    }

    check(sum(1, 2, 3), [1, 3, 6], 6);
    check(sum(9, -5, 3, 0, 2), [9, 4, 7, 7, 9], 9);
  });

  it("should alias function parameters", function() {
    function *gen(x, y) {
      yield x;
      ++arguments[0];
      yield x;

      yield y;
      --arguments[1];
      yield y;

      var temp = y;
      y = x;
      x = temp;

      yield x;
      yield y;
    }

    check(gen(3, 7), [3, 4, 7, 6, 6, 4]);
    check(gen(10, -5), [10, 11, -5, -6, -6, 11]);
  });

  it("should be shadowable by explicit declarations", function() {
    function *asParameter(x, arguments) {
      yield x + arguments;
    }

    check(asParameter(4, 5), [9]);
    check(asParameter("asdf", "zxcv"), ["asdfzxcv"]);

    function *asVariable(x) {
      // TODO References to arguments before the variable declaration
      // seem to see the object instead of the undefined value.
      var arguments = x + 1;
      yield arguments;
    }

    check(asVariable(4), [5]);
    check(asVariable("asdf"), ["asdf1"]);
  });

  it("should not get confused by properties", function() {
    function *gen(obj) {
      yield obj.arguments;
      obj.arguments = "oyez";
      yield obj;
    }

    check(gen({ arguments: 42 }), [42, { arguments: "oyez" }]);
  });

  it("supports .callee", function() {
    function *gen(doYield) {
      yield 1;
      if (doYield) {
        yield 2;
      } else {
        yield 3
        yield* arguments.callee(true);
        yield 4
      }
      yield 5;
    }

    check(gen(false), [1, 3, 1, 2, 5, 4, 5]);
  });
});

describe("catch parameter shadowing", function() {
  it("should leave outer variables unmodified", function() {
    function *gen(x) {
      var y = x + 1;
      try {
        throw x + 2;
      } catch (x) {
        yield x;
        x += 1;
        yield x;
      }
      yield x;
      try {
        throw x + 3;
      } catch (y) {
        yield y;
        y *= 2;
        yield y;
      }
      yield y;
    }

    check(gen(1), [3, 4, 1, 4, 8, 2]);
    check(gen(2), [4, 5, 2, 5, 10, 3]);
  });

  it("should not replace variables defined in inner scopes", function() {
    function *gen(x) {
      try {
        throw x;
      } catch (x) {
        yield x;

        yield (function(x) {
          return x += 1;
        }(x + 1));

        yield (function() {
          var x = arguments[0];
          return x * 2;
        }(x + 2));

        yield (function() {
          function notCalled(x) {
            throw x;
          }

          x >>= 1;
          return x;
        }());

        yield x -= 1;
      }

      yield x;
    }

    check(gen(10), [10, 12, 24, 5, 4, 10]);
    check(gen(11), [11, 13, 26, 5, 4, 11]);
  });
});

describe("empty while loops", function() {
  it("should be preserved in generated code", function() {
    function *gen(x) {
      while (x) {
        // empty while loop
      }

      do {
        // empty do-while loop
      } while (x);

      return gen.toString();
    }

    var info = gen(false).next();
    assert.strictEqual(info.done, true);
    assert.ok(/empty while loop/.test(info.value));
    assert.ok(/empty do-while loop/.test(info.value));
  });
});

describe("object literals with multiple yields", function() {
  it("should receive different sent values", function() {
    function *gen(fn) {
      return {
        a: yield "a",
        b: yield "b",
        c: fn(yield "c", yield "d"),
        d: [yield "e", yield "f"]
      };
    }

    check(gen(function sum(x, y) {
      return x + y;
    }), ["a", "b", "c", "d", "e", "f"], {
      a: 1,
      b: 2,
      c: 3 + 4,
      d: [5, 6]
    });
  });
});

describe("generator .throw method", function() {
  it("should work after the final call to .next", function() {
    function *gen() {
      yield 1;
    }

    var g = gen();
    assert.deepEqual(g.next(), { value: 1, done: false });

    var exception = new Error("unhandled exception");
    try {
      g.throw(exception);
      assert.ok(false, "should have thrown an exception");
    } catch (err) {
      assert.strictEqual(err, exception);
    }
  });

  it("should immediately complete a new-born generator", function() {
    var began = false;

    function *gen() {
      began = true;
      yield 1;
    }

    var g = gen();
    var exception = new Error("unhandled exception");
    try {
      g.throw(exception);
      assert.ok(false, "should have thrown an exception");
    } catch (err) {
      assert.strictEqual(err, exception);
      assert.strictEqual(began, false);
    }
  });
});

describe("unqualified function calls", function() {
  it("should have a global `this` object", function() {
    function getThis() {
      return this;
    }

    // This is almost certainly the global object, but there's a chance it
    // might be null or undefined (in strict mode).
    var unqualifiedThis = getThis();

    function *invoke() {
      // It seems like a bug in the ES6 spec that we have to yield an
      // argument instead of just calling (yield)().
      return (yield "dummy")();
    }

    var g = invoke();
    var info = g.next();

    assert.deepEqual(info, { value: "dummy", done: false });

    info = g.next(getThis);

    // Avoid using assert.strictEqual when the arguments might equal the
    // global object, since JSON.stringify chokes on circular structures.
    assert.ok(info.value === unqualifiedThis);

    assert.strictEqual(info.done, true);
  });
});

describe("yield* generator", function () {
  it("returns correct value", function () {
    function* foo() {
      yield 3;

      return yield* bar()
    }

    function* bar() {
      yield 3;

      return 4
    }

    var gen = foo()
    gen.next()
    gen.next()
    var value = gen.next().value

    assert.equal(value, 4)
  })

  it("returns correc thing", function () {
    function pumpNumber(gen) {
      var n = 0

      while (true) {
        var res = gen.next(n)
        n = res.value
        if (res.done) return n
      }
    }

    function* foo() {
      return (yield* bar()) + (yield* bar())
    }

    function* bar() {
      return (yield 2) + (yield 3)
    }

    var res1 = pumpNumber(bar())
    var res2 = pumpNumber(foo())

    assert.equal(res1, 5)
    assert.equal(res2, 10)
  })
})