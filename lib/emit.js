/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var types = require("ast-types");
var isArray = types.builtInTypes.array;
var b = types.builders;
var n = types.namedTypes;
var leap = require("./leap");
var meta = require("./meta");
var hasOwn = Object.prototype.hasOwnProperty;

function Emitter(contextId) {
  assert.ok(this instanceof Emitter);
  n.Identifier.assert(contextId);

  Object.defineProperties(this, {
    // In order to make sure the context object does not collide with
    // anything in the local scope, we might have to rename it, so we
    // refer to it symbolically instead of just assuming that it will be
    // called "context".
    contextId: { value: contextId },

    // An append-only list of Statements that grows each time this.emit is
    // called.
    listing: { value: [] },

    // A sparse array whose keys correspond to locations in this.listing
    // that have been marked as branch/jump targets.
    marked: { value: [true] },

    // The last location will be marked when this.getDispatchLoop is
    // called.
    finalLoc: { value: loc() }
  });

  // The .leapManager property needs to be defined by a separate
  // defineProperties call so that .finalLoc will be visible to the
  // leap.LeapManager constructor.
  Object.defineProperties(this, {
    // Each time we evaluate the body of a loop, we tell this.leapManager
    // to enter a nested loop context that determines the meaning of break
    // and continue statements therein.
    leapManager: { value: new leap.LeapManager(this) }
  });
}

var Ep = Emitter.prototype;
exports.Emitter = Emitter;

// Offsets into this.listing that could be used as targets for branches or
// jumps are represented as numeric Literal nodes. This representation has
// the amazingly convenient benefit of allowing the exact value of the
// location to be determined at any time, even after generating code that
// refers to the location.
function loc() {
  return b.literal(-1);
}

// Sets the exact value of the given location to the offset of the next
// Statement emitted.
Ep.mark = function(loc) {
  n.Literal.assert(loc);
  var index = this.listing.length;
  loc.value = index;
  this.marked[index] = true;
  return loc;
};

Ep.emit = function(node) {
  if (n.Expression.check(node))
    node = b.expressionStatement(node);
  n.Statement.assert(node);
  this.listing.push(node);
};

// Shorthand for emitting assignment statements. This will come in handy
// for assignments to temporary variables.
Ep.emitAssign = function(lhs, rhs) {
  this.emit(this.assign(lhs, rhs));
  return lhs;
};

// Shorthand for an assignment statement.
Ep.assign = function(lhs, rhs) {
  return b.expressionStatement(
    b.assignmentExpression("=", lhs, rhs));
};

// Convenience function for generating expressions like context.next,
// context.sent, and context.rval.
Ep.contextProperty = function(name) {
  return b.memberExpression(
    this.contextId,
    b.identifier(name),
    false
  );
};

var volatileContextPropertyNames = {
  next: true,
  sent: true,
  rval: true
};

// A "volatile" context property is a MemberExpression like context.sent
// that should probably be stored in a temporary variable when there's a
// possibility the property will get overwritten.
Ep.isVolatileContextProperty = function(expr) {
  if (n.MemberExpression.check(expr)) {
    if (expr.computed) {
      // If it's a computed property such as context[couldBeAnything],
      // assume the worst in terms of volatility.
      return true;
    }

    if (n.Identifier.check(expr.object) &&
        n.Identifier.check(expr.property) &&
        expr.object.name === this.contextId.name &&
        hasOwn.call(volatileContextPropertyNames,
                    expr.property.name)) {
      return true;
    }
  }

  return false;
};

// Shorthand for setting context.rval and jumping to `context.stop()`.
Ep.stop = function(rval) {
  if (rval) {
    this.setReturnValue(rval);
  }

  this.jump(this.finalLoc);
};

Ep.setReturnValue = function(valuePath) {
  n.Expression.assert(valuePath.value);

  this.emitAssign(
    this.contextProperty("rval"),
    this.explodeExpression(valuePath)
  );
};

Ep.popPendingException = function(assignee) {
  var popExp = b.callExpression(
    b.memberExpression(
      this.contextProperty("throwStack"),
      b.identifier("pop"),
      false
    ),
    []
  );

  if (assignee) {
    this.emitAssign(assignee, popExp);
  } else {
    this.emit(popExp);
  }
};

// Emits code for an unconditional jump to the given location, even if the
// exact value of the location is not yet known.
Ep.jump = function(toLoc) {
  this.emitAssign(this.contextProperty("next"), toLoc);
  this.emit(b.breakStatement());
};

// Conditional jump.
Ep.jumpIf = function(test, toLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(b.ifStatement(
    test,
    b.blockStatement([
      this.assign(this.contextProperty("next"), toLoc),
      b.breakStatement()
    ])
  ));
};

// Conditional jump, with the condition negated.
Ep.jumpIfNot = function(test, toLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(b.ifStatement(
    b.unaryExpression("!", test),
    b.blockStatement([
      this.assign(this.contextProperty("next"), toLoc),
      b.breakStatement()
    ])
  ));
};

// Returns a unique MemberExpression that can be used to store and
// retrieve temporary values. Since the object of the member expression is
// the context object, which is presumed to coexist peacefully with all
// other local variables, and since we just increment `nextTempId`
// monotonically, uniqueness is assured.
var nextTempId = 0;
Ep.makeTempVar = function() {
  return this.contextProperty("t" + nextTempId++);
};

Ep.getContextFunction = function(id) {
  return b.functionExpression(
    id || null/*Anonymous*/,
    [this.contextId],
    b.blockStatement([this.getDispatchLoop()]),
    false, // Not a generator anymore!
    false // Nor an expression.
  );
};

// Turns this.listing into a loop of the form
//
//   while (1) switch (context.next) {
//   case 0:
//   ...
//   case n:
//     return context.stop();
//   }
//
// Each marked location in this.listing will correspond to one generated
// case statement.
Ep.getDispatchLoop = function() {
  var self = this;
  var cases = [];
  var current;

  // If we encounter a break, continue, or return statement in a switch
  // case, we can skip the rest of the statements until the next case.
  var alreadyEnded = false;

  self.listing.forEach(function(stmt, i) {
    if (self.marked.hasOwnProperty(i)) {
      cases.push(b.switchCase(
        b.literal(i),
        current = []));
      alreadyEnded = false;
    }

    if (!alreadyEnded) {
      current.push(stmt);
      if (isSwitchCaseEnder(stmt))
        alreadyEnded = true;
    }
  });

  // Now that we know how many statements there will be in this.listing,
  // we can finally resolve this.finalLoc.value.
  this.finalLoc.value = this.listing.length;

  cases.push(
    b.switchCase(this.finalLoc, [
      // Intentionally fall through to the "end" case...
    ]),

    // So that the runtime can jump to the final location without having
    // to know its offset, we provide the "end" case as a synonym.
    b.switchCase(b.literal("end"), [
      // This will check/clear both context.throwStack and context.rval.
      b.returnStatement(
        b.callExpression(this.contextProperty("stop"), [])
      )
    ])
  );

  return b.whileStatement(
    b.literal(1),
    b.switchStatement(this.contextProperty("next"), cases)
  );
};

// See comment above re: alreadyEnded.
function isSwitchCaseEnder(stmt) {
  return n.BreakStatement.check(stmt)
      || n.ContinueStatement.check(stmt)
      || n.ReturnStatement.check(stmt)
      || n.ThrowStatement.check(stmt);
}

// All side effects must be realized in order.

// If any subexpression harbors a leap, all subexpressions must be
// neutered of side effects.

// No destructive modification of AST nodes.

Ep.explode = function(path, ignoreResult) {
  assert.ok(path instanceof types.NodePath);

  var node = path.value;
  var self = this;

  n.Node.assert(node);

  if (n.Statement.check(node))
    return self.explodeStatement(path);

  if (n.Expression.check(node))
    return self.explodeExpression(path, ignoreResult);

  if (n.Declaration.check(node))
    throw getDeclError(node);

  switch (node.type) {
  case "Program":
    return path.get("body").map(
      self.explodeStatement,
      self
    );

  case "VariableDeclarator":
    throw getDeclError(node);

  // These node types should be handled by their parent nodes
  // (ObjectExpression, SwitchStatement, and TryStatement, respectively).
  case "Property":
  case "SwitchCase":
  case "CatchClause":
    throw new Error(
      node.type + " nodes should be handled by their parents");

  default:
    throw new Error(
      "unknown Node of type " +
        JSON.stringify(node.type));
  }
};

function getDeclError(node) {
  return new Error(
    "all declarations should have been transformed into " +
    "assignments before the Exploder began its work: " +
    JSON.stringify(node));
}

Ep.explodeStatement = function(path, labelId) {
  assert.ok(path instanceof types.NodePath);

  var stmt = path.value;
  var self = this;

  n.Statement.assert(stmt);

  if (labelId) {
    n.Identifier.assert(labelId);
  } else {
    labelId = null;
  }

  // Explode BlockStatement nodes even if they do not contain a yield,
  // because we don't want or need the curly braces.
  if (n.BlockStatement.check(stmt)) {
    return path.get("body").each(
      self.explodeStatement,
      self
    );
  }

  if (!meta.containsLeap(stmt)) {
    // Technically we should be able to avoid emitting the statement
    // altogether if !meta.hasSideEffects(stmt), but that leads to
    // confusing generated code (for instance, `while (true) {}` just
    // disappears) and is probably a more appropriate job for a dedicated
    // dead code elimination pass.
    self.emit(stmt);
    return;
  }

  switch (stmt.type) {
  case "ExpressionStatement":
    self.explodeExpression(path.get("expression"), true);
    break;

  case "LabeledStatement":
    self.explodeStatement(path.get("body"), stmt.label);
    break;

  case "WhileStatement":
    var before = loc();
    var after = loc();

    self.mark(before);
    self.jumpIfNot(self.explodeExpression(path.get("test")), after);
    self.leapManager.withEntry(
      new leap.LoopEntry(after, before, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );
    self.jump(before);
    self.mark(after);

    break;

  case "DoWhileStatement":
    var first = loc();
    var test = loc();
    var after = loc();

    self.mark(first);
    self.leapManager.withEntry(
      new leap.LoopEntry(after, test, labelId),
      function() { self.explode(path.get("body")); }
    );
    self.mark(test);
    self.jumpIf(self.explodeExpression(path.get("test")), first);
    self.mark(after);

    break;

  case "ForStatement":
    var head = loc();
    var update = loc();
    var after = loc();

    if (stmt.init) {
      // We pass true here to indicate that if stmt.init is an expression
      // then we do not care about its result.
      self.explode(path.get("init"), true);
    }

    self.mark(head);

    if (stmt.test) {
      self.jumpIfNot(self.explodeExpression(path.get("test")), after);
    } else {
      // No test means continue unconditionally.
    }

    self.leapManager.withEntry(
      new leap.LoopEntry(after, update, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );

    self.mark(update);

    if (stmt.update) {
      // We pass true here to indicate that if stmt.update is an
      // expression then we do not care about its result.
      self.explode(path.get("update"), true);
    }

    self.jump(head);

    self.mark(after);

    break;

  case "ForInStatement":
    n.Identifier.assert(stmt.left);

    var head = loc();
    var after = loc();

    var keysPath = new types.NodePath(b.callExpression(
      self.contextProperty("keys"),
      [stmt.right]
    ), path, "right");

    var keys = self.emitAssign(
      self.makeTempVar(),
      self.explodeExpression(keysPath)
    );

    self.mark(head);

    self.jumpIfNot(
      b.memberExpression(
        keys,
        b.identifier("length"),
        false
      ),
      after
    );

    self.emitAssign(
      stmt.left,
      b.callExpression(
        b.memberExpression(
          keys,
          b.identifier("pop"),
          false
        ),
        []
      )
    );

    self.leapManager.withEntry(
      new leap.LoopEntry(after, head, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );

    self.jump(head);

    self.mark(after);

    break;

  case "BreakStatement":
    self.leapManager.emitBreak(stmt.label);
    break;

  case "ContinueStatement":
    self.leapManager.emitContinue(stmt.label);
    break;

  case "SwitchStatement":
    // Always save the discriminant into a temporary variable in case the
    // test expressions overwrite values like context.sent.
    var disc = self.emitAssign(
      self.makeTempVar(),
      self.explodeExpression(path.get("discriminant"))
    );

    var after = loc();
    var defaultLoc = loc();
    var condition = defaultLoc;
    var caseLocs = [];

    // If there are no cases, .cases might be undefined.
    var cases = stmt.cases || [];

    for (var i = cases.length - 1; i >= 0; --i) {
      var c = cases[i];
      n.SwitchCase.assert(c);

      if (c.test) {
        condition = b.conditionalExpression(
          b.binaryExpression("===", disc, c.test),
          caseLocs[i] = loc(),
          condition
        );
      } else {
        caseLocs[i] = defaultLoc;
      }
    }

    self.jump(self.explodeExpression(
      new types.NodePath(condition, path, "discriminant")
    ));

    self.leapManager.withEntry(
      new leap.SwitchEntry(after),
      function() {
        path.get("cases").each(function(casePath) {
          var c = casePath.value;
          var i = casePath.name;

          self.mark(caseLocs[i]);

          casePath.get("consequent").each(
            self.explodeStatement,
            self
          );
        });
      }
    );

    self.mark(after);
    if (defaultLoc.value === -1) {
      self.mark(defaultLoc);
      assert.strictEqual(after.value, defaultLoc.value);
    }

    break;

  case "IfStatement":
    var elseLoc = stmt.alternate && loc();
    var after = loc();

    self.jumpIfNot(
      self.explodeExpression(path.get("test")),
      elseLoc || after
    );

    self.explodeStatement(path.get("consequent"));

    if (elseLoc) {
      self.jump(after);
      self.mark(elseLoc);
      self.explodeStatement(path.get("alternate"));
    }

    self.mark(after);

    break;

  case "ReturnStatement":
    self.leapManager.emitReturn(path.get("argument"));
    break;

  case "WithStatement":
    throw new Error(
      node.type + " not supported in generator functions.");

  case "TryStatement":
    var after = loc();

    var handler = stmt.handler;
    if (!handler && stmt.handlers) {
      handler = stmt.handlers[0] || null;
    }

    var catchLoc = handler && loc();
    var catchEntry = catchLoc && new leap.CatchEntry(
      catchLoc,
      handler.param
    );

    var finallyLoc = stmt.finalizer && loc();
    var finallyEntry = finallyLoc && new leap.FinallyEntry(
      finallyLoc,
      self.makeTempVar()
    );

    if (finallyEntry) {
      // Finally blocks examine their .nextLocTempVar property to figure
      // out where to jump next, so we must set that property to the
      // fall-through location, by default.
      self.emitAssign(finallyEntry.nextLocTempVar, after);
    }

    var tryEntry = new leap.TryEntry(catchEntry, finallyEntry);

    // Push information about this try statement so that the runtime can
    // figure out what to do if it gets an uncaught exception.
    self.pushTry(tryEntry);

    self.leapManager.withEntry(tryEntry, function() {
      self.explodeStatement(path.get("block"));

      if (catchLoc) {
        // If execution leaves the try block normally, the associated
        // catch block no longer applies.
        self.popCatch(catchEntry);

        if (finallyLoc) {
          // If we have both a catch block and a finally block, then
          // because we emit the catch block first, we need to jump over
          // it to the finally block.
          self.jump(finallyLoc);

        } else {
          // If there is no finally block, then we need to jump over the
          // catch block to the fall-through location.
          self.jump(after);
        }

        self.mark(catchLoc);

        // On entering a catch block, we must not have exited the
        // associated try block normally, so we won't have called
        // context.popCatch yet.  Call it here instead.
        self.popCatch(catchEntry);

        var bodyPath = path.get("handler", "body");
        var safeParam = self.makeTempVar();
        self.popPendingException(safeParam);

        var catchScope = bodyPath.scope;
        var catchParamName = handler.param.name;
        n.CatchClause.assert(catchScope.node);
        assert.strictEqual(catchScope.lookup(catchParamName), catchScope);

        types.traverse(bodyPath, function(node) {
          if (n.Identifier.check(node) &&
              node.name === catchParamName &&
              this.scope.lookup(catchParamName) === catchScope) {
            this.replace(safeParam);
            return false;
          }
        });

        self.leapManager.withEntry(catchEntry, function() {
          self.explodeStatement(bodyPath);
        });
      }

      if (finallyLoc) {
        self.mark(finallyLoc);

        self.popFinally(finallyEntry);

        self.leapManager.withEntry(finallyEntry, function() {
          self.explodeStatement(path.get("finalizer"));
        });

        self.jump(finallyEntry.nextLocTempVar);
      }
    });

    self.mark(after);

    break;

  case "ThrowStatement":
    self.emit(b.throwStatement(
      self.explodeExpression(path.get("argument"))
    ));

    break;

  default:
    throw new Error(
      "unknown Statement of type " +
        JSON.stringify(stmt.type));
  }
};

// Emit a runtime call to context.pushTry(catchLoc, finallyLoc) so that
// the runtime wrapper can dispatch uncaught exceptions appropriately.
Ep.pushTry = function(tryEntry) {
  assert.ok(tryEntry instanceof leap.TryEntry);

  var nil = b.literal(null);
  var catchEntry = tryEntry.catchEntry;
  var finallyEntry = tryEntry.finallyEntry;
  var method = this.contextProperty("pushTry");
  var args = [
    catchEntry && catchEntry.firstLoc || nil,
    finallyEntry && finallyEntry.firstLoc || nil,
    finallyEntry && b.literal(
      finallyEntry.nextLocTempVar.property.name
    ) || nil
  ];

  this.emit(b.callExpression(method, args));
};

// Emit a runtime call to context.popCatch(catchLoc) so that the runtime
// wrapper knows when a catch block reported to pushTry no longer applies.
Ep.popCatch = function(catchEntry) {
  var catchLoc;

  if (catchEntry) {
    assert.ok(catchEntry instanceof leap.CatchEntry);
    catchLoc = catchEntry.firstLoc;
  } else {
    assert.strictEqual(catchEntry, null);
    catchLoc = b.literal(null);
  }

  // TODO Think about not emitting anything when catchEntry === null.  For
  // now, emitting context.popCatch(null) is good for sanity checking.

  this.emit(b.callExpression(
    this.contextProperty("popCatch"),
    [catchLoc]
  ));
};

// Emit a runtime call to context.popFinally(finallyLoc) so that the
// runtime wrapper knows when a finally block reported to pushTry no
// longer applies.
Ep.popFinally = function(finallyEntry) {
  var finallyLoc;

  if (finallyEntry) {
    assert.ok(finallyEntry instanceof leap.FinallyEntry);
    finallyLoc = finallyEntry.firstLoc;
  } else {
    assert.strictEqual(finallyEntry, null);
    finallyLoc = b.literal(null);
  }

  // TODO Think about not emitting anything when finallyEntry === null.
  // For now, emitting context.popFinally(null) is good for sanity
  // checking.

  this.emit(b.callExpression(
    this.contextProperty("popFinally"),
    [finallyLoc]
  ));
};

Ep.explodeExpression = function(path, ignoreResult) {
  assert.ok(path instanceof types.NodePath);

  var expr = path.value;
  if (expr) {
    n.Expression.assert(expr);
  } else {
    return expr;
  }

  var self = this;
  var result; // Used optionally by several cases below.

  function finish(expr) {
    n.Expression.assert(expr);
    if (ignoreResult) {
      self.emit(expr);
    } else {
      return expr;
    }
  }

  // If the expression does not contain a leap, then we either emit the
  // expression as a standalone statement or return it whole.
  if (!meta.containsLeap(expr)) {
    return finish(expr);
  }

  // If any child contains a leap (such as a yield or labeled continue or
  // break statement), then any sibling subexpressions will almost
  // certainly have to be exploded in order to maintain the order of their
  // side effects relative to the leaping child(ren).
  var hasLeapingChildren = meta.containsLeap.onlyChildren(expr);

  // In order to save the rest of explodeExpression from a combinatorial
  // trainwreck of special cases, explodeViaTempVar is responsible for
  // deciding when a subexpression needs to be "exploded," which is my
  // very technical term for emitting the subexpression as an assignment
  // to a temporary variable and the substituting the temporary variable
  // for the original subexpression. Think of exploded view diagrams, not
  // Michael Bay movies. The point of exploding subexpressions is to
  // control the precise order in which the generated code realizes the
  // side effects of those subexpressions.
  function explodeViaTempVar(tempVar, childPath, ignoreChildResult) {
    assert.ok(childPath instanceof types.NodePath);

    assert.ok(
      !ignoreChildResult || !tempVar,
      "Ignoring the result of a child expression but forcing it to " +
        "be assigned to a temporary variable?"
    );

    var result = self.explodeExpression(childPath, ignoreChildResult);

    if (ignoreChildResult) {
      // Side effects already emitted above.

    } else if (tempVar || (hasLeapingChildren &&
                           (self.isVolatileContextProperty(result) ||
                            meta.hasSideEffects(result)))) {
      // If tempVar was provided, then the result will always be assigned
      // to it, even if the result does not otherwise need to be assigned
      // to a temporary variable.  When no tempVar is provided, we have
      // the flexibility to decide whether a temporary variable is really
      // necessary.  In general, temporary assignment is required only
      // when some other child contains a leap and the child in question
      // is a context property like $ctx.sent that might get overwritten
      // or an expression with side effects that need to occur in proper
      // sequence relative to the leap.
      result = self.emitAssign(
        tempVar || self.makeTempVar(),
        result
      );
    }
    return result;
  }

  // If ignoreResult is true, then we must take full responsibility for
  // emitting the expression with all its side effects, and we should not
  // return a result.

  switch (expr.type) {
  case "MemberExpression":
    return finish(b.memberExpression(
      self.explodeExpression(path.get("object")),
      expr.computed
        ? explodeViaTempVar(null, path.get("property"))
        : expr.property,
      expr.computed
    ));

  case "CallExpression":
    var oldCalleePath = path.get("callee");
    var newCallee = self.explodeExpression(oldCalleePath);

    // If the callee was not previously a MemberExpression, then the
    // CallExpression was "unqualified," meaning its `this` object should
    // be the global object. If the exploded expression has become a
    // MemberExpression, then we need to force it to be unqualified by
    // using the (0, object.property)(...) trick; otherwise, it will
    // receive the object of the MemberExpression as its `this` object.
    if (!n.MemberExpression.check(oldCalleePath.node) &&
        n.MemberExpression.check(newCallee)) {
      newCallee = b.sequenceExpression([
        b.literal(0),
        newCallee
      ]);
    }

    return finish(b.callExpression(
      newCallee,
      path.get("arguments").map(function(argPath) {
        return explodeViaTempVar(null, argPath);
      })
    ));

  case "NewExpression":
    return finish(b.newExpression(
      explodeViaTempVar(null, path.get("callee")),
      path.get("arguments").map(function(argPath) {
        return explodeViaTempVar(null, argPath);
      })
    ));

  case "ObjectExpression":
    return finish(b.objectExpression(
      path.get("properties").map(function(propPath) {
        return b.property(
          propPath.value.kind,
          propPath.value.key,
          explodeViaTempVar(null, propPath.get("value"))
        );
      })
    ));

  case "ArrayExpression":
    return finish(b.arrayExpression(
      path.get("elements").map(function(elemPath) {
        return explodeViaTempVar(null, elemPath);
      })
    ));

  case "SequenceExpression":
    var lastIndex = expr.expressions.length - 1;

    path.get("expressions").each(function(exprPath) {
      if (exprPath.name === lastIndex) {
        result = self.explodeExpression(exprPath, ignoreResult);
      } else {
        self.explodeExpression(exprPath, true);
      }
    });

    return result;

  case "LogicalExpression":
    var after = loc();

    if (!ignoreResult) {
      result = self.makeTempVar();
    }

    var left = explodeViaTempVar(result, path.get("left"));

    if (expr.operator === "&&") {
      self.jumpIfNot(left, after);
    } else if (expr.operator = "||") {
      self.jumpIf(left, after);
    }

    explodeViaTempVar(result, path.get("right"), ignoreResult);

    self.mark(after);

    return result;

  case "ConditionalExpression":
    var elseLoc = loc();
    var after = loc();
    var test = self.explodeExpression(path.get("test"));

    self.jumpIfNot(test, elseLoc);

    if (!ignoreResult) {
      result = self.makeTempVar();
    }

    explodeViaTempVar(result, path.get("consequent"), ignoreResult);
    self.jump(after);

    self.mark(elseLoc);
    explodeViaTempVar(result, path.get("alternate"), ignoreResult);

    self.mark(after);

    return result;

  case "UnaryExpression":
    return finish(b.unaryExpression(
      expr.operator,
      // Can't (and don't need to) break up the syntax of the argument.
      // Think about delete a[b].
      self.explodeExpression(path.get("argument")),
      !!expr.prefix
    ));

  case "BinaryExpression":
    return finish(b.binaryExpression(
      expr.operator,
      explodeViaTempVar(null, path.get("left")),
      explodeViaTempVar(null, path.get("right"))
    ));

  case "AssignmentExpression":
    return finish(b.assignmentExpression(
      expr.operator,
      self.explodeExpression(path.get("left")),
      self.explodeExpression(path.get("right"))
    ));

  case "UpdateExpression":
    return finish(b.updateExpression(
      expr.operator,
      self.explodeExpression(path.get("argument")),
      expr.prefix
    ));

  case "YieldExpression":
    var after = loc();
    var arg = expr.argument && self.explodeExpression(path.get("argument"));

    if (arg && expr.delegate) {
      var result = self.makeTempVar();

      self.emit(b.returnStatement(b.callExpression(
        self.contextProperty("delegateYield"), [
          arg,
          b.literal(result.property.name),
          after
        ]
      )));

      self.mark(after);

      return result;
    }

    self.emitAssign(self.contextProperty("next"), after);
    self.emit(b.returnStatement(arg || null));
    self.mark(after);

    return self.contextProperty("sent");

  default:
    throw new Error(
      "unknown Expression of type " +
        JSON.stringify(expr.type));
  }
};
