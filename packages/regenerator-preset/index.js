module.exports = {
  buildPreset: function (context, opts) {
    opts = opts !== undefined ? opts : {};
    var modules = opts.modules !== undefined ? opts.modules : true;
    var loose = opts.loose !== undefined ? opts.loose : false;
    var strict = opts.strict !== undefined ? opts.strict : true;
    var globalRuntimeName = opts.globalRuntimeName !== undefined ? opts.globalRuntimeName : false;

    var plugins = [
      require("babel-plugin-syntax-async-functions"),
      require("babel-plugin-syntax-async-generators"),
      require("babel-plugin-transform-es2015-classes"),
      require("babel-plugin-transform-es2015-arrow-functions"),
      require("babel-plugin-transform-es2015-block-scoping"),
      require("babel-plugin-transform-es2015-for-of"),
      [require("regenerator-transform"), { globalRuntimeName: globalRuntimeName }]
    ];

    if (modules) {
      plugins.push([require("babel-plugin-transform-es2015-modules-commonjs"), { loose: loose, strict: strict }]);
    }

    return {
      plugins: plugins,
    };
  }
};
