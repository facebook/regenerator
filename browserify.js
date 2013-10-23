var through = require('through'),
    convert = require('convert-source-map'),
    regenerate = require('./main');

function isString(obj) {
  return Object.prototype.toString.call(obj) === "[object String]";
}

module.exports = function(filename) {
  var buf = '';
  return through(
    function(chunk) { buf = buf + chunk; },
    function() {
      var result = regenerate(buf, {sourceMap: filename});
      if (isString(result)) {
        this.queue(result);
      } else {
        result.map.setSourceContent(filename, buf);
        this.queue(
          result.code +
          '\n' +
          convert.fromObject(result.map).toComment());
      }
      this.queue(null);
    });
}
