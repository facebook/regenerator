/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { addDefault } from "@babel/helper-module-imports";

let currentTypes = null;

export function wrapWithTypes(types, fn) {
  return function (...args) {
    const oldTypes = currentTypes;
    currentTypes = types;
    try {
      return fn.apply(this, args);
    } finally {
      currentTypes = oldTypes;
    }
  };
}

export function getTypes() {
  return currentTypes;
}

const runtimeNames = new WeakMap();

export function runtimeProperty(name, scope, opts) {
  const t = getTypes();

  let runtimeId;
  if (!opts.importRuntime) {
    runtimeId = t.identifier("regeneratorRuntime");
  } else {
    const programPath = scope.getProgramParent().path;
    if (runtimeNames.has(programPath.node)) {
      runtimeId = t.identifier(runtimeNames.get(programPath.node));
    } else {
      runtimeId = addDefault(programPath, "regenerator-runtime", {
        nameHint: "regeneratorRuntime",
        importedInterop: "uncompiled",
        blockHoist: 3
      });
      runtimeNames.set(programPath.node, runtimeId.name);
    }
  }

  return t.memberExpression(
    runtimeId,
    t.identifier(name),
    false
  );
}

export function isReference(path) {
  return path.isReferenced() || path.parentPath.isAssignmentExpression({ left: path.node });
}

export function replaceWithOrRemove(path, replacement) {
  if (replacement) {
    path.replaceWith(replacement)
  } else {
    path.remove();
  }
}
