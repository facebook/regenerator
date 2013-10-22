var through = require('through'),
    convert = require('convert-source-map'),
    regenerate = require('./main');

module.exports = function(filename) {
  var buf = '';
  return through(
    function(chunk) { buf = buf + chunk; },
    function() {
      var result = regenerate(buf, {sourceMap: filename});
      if (typeof result === 'string') {
        this.queue(result);
      } else {
        var map = convert.fromObject(result.map);
        map.setProperty('sources', [filename]);
        this.queue(result.code + '\n' + map.toComment());
      }
      this.queue(null);
    });
}
