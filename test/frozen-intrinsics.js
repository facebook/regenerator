/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var assert = require("assert");

Object.freeze(Object.prototype)


describe("Frozen intrinsics test", function () {
  it("regenerator-runtime doesn't fail to initialize when Object prototype is frozen", function() {
    require("./runtime.js");
  });
});
