var assert = require("assert");
var recast = require("recast");
var types = recast.types;
var n = types.namedTypes;
var transform = require("..").transform;
describe("es6 exports", function() {
  it("should work", function() {
    var ast = recast.parse([
      "export function *foo() {",
      "  return 123;",
      "}",
      "export default function *bar() {",
      "  return 123;",
      "}",
    ].join("\n"), {
      parser: require("babylon")
    });

    const code = recast.print(transform(ast)).code;
    // can't eval this because of the es6 module syntax so just search for our exports
    assert.ok(code.indexOf('export { foo };') !== -1);
    assert.ok(code.indexOf('export default bar;') !== -1);
  })
})

describe("pure", function() {
  it("should work with a function expression", function() {
    var ast = recast.parse('var a = function* foo(){};', {
        parser: require("babylon")
    });
    const code = recast.print(transform(ast)).code;
    assert.ok(
      code.indexOf(
        'var a = /*#__PURE__*/regeneratorRuntime.mark(function foo() {'
      ) !== 1
    )
  })
  it("should work with a function declaration", function() {
    var ast = recast.parse('function* foo(){};', {
      parser: require("babylon")
    });
    const code = recast.print(transform(ast)).code;
    assert.ok(
      code.indexOf(
        'var a = /*#__PURE__*/Object.defineProperty( /*#__PURE__*/regeneratorRuntime.mark'
      ) !== 1
    )
  })
})
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
    ].join("\n"), {
      parser: require("babylon")
    });

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
