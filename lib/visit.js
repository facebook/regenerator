/**
 * Copyright (c) 2014, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var recast = require("recast");
var types = recast.types;
var n = types.namedTypes;
var util = require("./util.js");

exports.transform = function transform(node, options) {
  options = util.defaults(options || {}, {
    includeRuntime: false,
    presetOptions: {},
  });
  options.presetOptions.globalRuntimeName = options.includeRuntime === true && "regeneratorRuntime";

  var result = require("babel-core").transformFromAst(node, null, {
    presets: [["regenerator-preset", options.presetOptions]],
    code: false,
    ast: true
  });

  node = result.ast;

  if (options.includeRuntime === true) {
    injectRuntime(n.File.check(node) ? node.program : node);
  }

  return node;
};

function injectRuntime(program) {
  n.Program.assert(program);

  // Include the runtime by modifying the AST rather than by concatenating
  // strings. This technique will allow for more accurate source mapping.
  var runtime = require("..").runtime;
  var runtimeBody = recast.parse(runtime.getCode(), {
    sourceFileName: runtime.path,
  }).program.body;

  var body = program.body;
  body.unshift.apply(body, runtimeBody);
}
