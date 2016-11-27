var assert = require("assert");
var recast = require("recast");
var types = recast.types;
var n = types.namedTypes;
var transform = require("..").transform;

describe("_blockHoist nodes", function() {
  it("should be hoisted to the outer body", function() {
    var foo;
    var names = [];
    var ast = recast.parse([
      "function *foo(doNotHoistMe, hoistMe) {",
      "  var sent = yield doNotHoistMe();",
      "  hoistMe();",
      "  names.push(sent);",
      "  return 123;",
      "}"
    ].join("\n"));

    var hoistMeStmt = ast.program.body[0].body.body[1];
    n.ExpressionStatement.assert(hoistMeStmt);
    n.CallExpression.assert(hoistMeStmt.expression);
    n.Identifier.assert(hoistMeStmt.expression.callee);
    assert.strictEqual(hoistMeStmt.expression.callee.name, "hoistMe");

    hoistMeStmt._blockHoist = 1;

    eval(recast.print(transform(ast)).code);

    assert.strictEqual(typeof foo, "function");
    assert.ok(regeneratorRuntime.isGeneratorFunction(foo));
    assert.strictEqual(names.length, 0);

    var g = foo(function doNotHoistMe() {
      names.push("doNotHoistMe");
      return "yielded";
    }, function hoistMe() {
      names.push("hoistMe");
    });

    assert.deepEqual(names, ["hoistMe"]);
    assert.deepEqual(g.next(), { value: "yielded", done: false });
    assert.deepEqual(names, ["hoistMe", "doNotHoistMe"]);
    assert.deepEqual(g.next("oyez"), { value: 123, done: true });
    assert.deepEqual(names, ["hoistMe", "doNotHoistMe", "oyez"]);
  });
});

describe("awaiting result", function() {
  it("should not use unnecessary cases when returning", function() {
    var parsed = recast.parse([
      "async function foo(bar) {",
      "  return await bar();",
      "}"
    ].join("\n"));

    var afterTransformation = transform(parsed);

    // Dive into transformed AST and confirm the number of case statements used
    // in the inner FSM.
    var returnStmt = afterTransformation.program.body[0].body.body[0];
    assert.deepEqual(returnStmt.type, "ReturnStatement");
    var whileStmt = returnStmt.argument.arguments[0].body.body[0];
    assert.deepEqual(whileStmt.type, "WhileStatement");
    var switchStmt = whileStmt.body;
    assert.deepEqual(switchStmt.type, "SwitchStatement");
    // 1. setup
    // 2. returning await
    // 3. `end`
    assert.deepEqual(switchStmt.cases.length, 3);

    // Sense-check the behaviour of this function
    eval(recast.print(parsed).code);
    assert.strictEqual(typeof foo, "function");

    var resultPromise = foo(function bar() {
      return "finished";
    });
    return resultPromise.then(function (promiseResolution) {
      assert.strictEqual(promiseResolution, "finished");
    });
  });

  it("should not use unnecessary cases when throwing", function() {
    var parsed = recast.parse([
      "async function foo() {",
      "  throw new Error();",
      "}"
    ].join("\n"));

    var afterTransformation = transform(parsed);

    // Dive into transformed AST and confirm the number of case statements used
    // in the inner FSM.
    var returnStmt = afterTransformation.program.body[0].body.body[0];
    assert.deepEqual(returnStmt.type, "ReturnStatement");
    var whileStmt = returnStmt.argument.arguments[0].body.body[0];
    assert.deepEqual(whileStmt.type, "WhileStatement");
    var switchStmt = whileStmt.body;
    assert.deepEqual(switchStmt.type, "SwitchStatement");
    // 1. setup and throw
    // 2. end
    assert.deepEqual(switchStmt.cases.length, 2);

    // Sense-check the behaviour of this function
    eval(recast.print(parsed).code);
    assert.strictEqual(typeof foo, "function");

    return foo().catch(function (error) {
      assert(error instanceof Error);
    });
  });
});
