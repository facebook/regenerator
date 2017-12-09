#!/usr/bin/env node

var compile = require("../main").compile;

require("commoner")
  .version(require("../package.json").version)
  .resolve(function(id) {
    return this.readModuleP(id);
  })
  .option("-r, --include-runtime", "Prepend the runtime to the output.")
  .option("--disable-async", "Disable transformation of async functions.")
  .process(function(id, source) {
    return compile(source, {
      includeRuntime: this.options.includeRuntime,
      disableAsync: this.options.disableAsync,
    }).code;
  });
