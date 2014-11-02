// Make sure regeneratorRuntime is defined.
regenerator.runtime();

var input = CodeMirror(function(input) {
  document.getElementById("inputWrapper").appendChild(input);
}, {
  value: [
    "function *range(max, step) {",
    "  var count = 0;",
    "  step = step || 1;",
    "",
    "  for (var i = 0; i < max; i += step) {",
    "    count++;",
    "    yield i;",
    "  }",
    "",
    "  return count;",
    "}",
    "",
    "var gen = range(20, 3), info;",
    "",
    "while (!(info = gen.next()).done) {",
    "  console.log(info.value);",
    "}",
    "",
    'console.log("steps taken: " + info.value);'
  ].join("\n"),
  mode: "javascript",
  indentUnit: 2,
  autofocus: true
});

var regeneratorOptions = {
  supportBlockBinding: true
};

var output = CodeMirror(function(output) {
  document.getElementById("outputWrapper").appendChild(output);
}, {
  value: regenerator.compile(input.getValue(), regeneratorOptions).code,
  readOnly: true
});

var doc = document;
var head = doc.documentElement.firstChild;
var delayTimer;
var delayMS = 100;

CodeMirror.on(input.doc, "change", function(instance) {
  clearTimeout(delayTimer);
  delayTimer = setTimeout(function() {
    try {
      output.setValue(regenerator.compile(
        instance.getValue(),
        regeneratorOptions
      ).code);
    } catch (err) {
      console.log(err);
    }
  }, delayMS);
});

function toggleComparison(event) {
  var ul = document.getElementById("comparison");
  ul.setAttribute("class", ul.className.match(/\bhidden\b/) ? "" : "hidden");

  var tn = document.getElementById("punctuation").firstChild;
  tn.nodeValue = tn.nodeValue.replace(/^\s*([\.:])/, function(_, punctuation) {
    return punctuation === "." ? ":" : ".";
  });
  if (event && event.preventDefault) {
    event.preventDefault();
  }
}

function reportBug(event) {
  var doc = document;
  var form = doc.createElement("form");

  var title = doc.createElement("input");
  title.setAttribute("type", "hidden");
  var body = title.cloneNode(false);

  title.setAttribute("name", "title");
  title.setAttribute("value", "Sandbox bug report");
  form.appendChild(title);

  body.setAttribute("name", "body");
  body.setAttribute("value", [
    "The following code does not transform as expected:",
    "```js",
    input.getValue(),
    "```"
  ].join("\n"));
  form.appendChild(body);

  form.setAttribute("action", "https://github.com/facebook/regenerator/issues/new");
  form.setAttribute("method", "GET");
  form.setAttribute("target", "_blank");

  document.body.appendChild(form);
  form.submit();
  form.parentNode.removeChild(form);
  if (event && event.preventDefault) {
    event.preventDefault();
  }
}

function evaluateOutput(event) {
  var script = doc.createElement("script");
  script.appendChild(doc.createTextNode(output.getValue()));
  head.appendChild(script);
  if (event && event.preventDefault) {
    event.preventDefault();
  }
}

CodeMirror.on(document, "keydown", function(event) {
  if (event.ctrlKey && event.which === 13) {
    event.preventDefault();
    evaluateOutput();
  }
});

(function() {
  var clickableElementsEvents = {
    '#toggleComparison': toggleComparison,
    '#reportBug': reportBug,
    '#evaluateOutput': evaluateOutput
    
  };
  var element, key, eventHandler;
  for (key in clickableElementsEvents) {
    if (Object.prototype.hasOwnProperty.call(clickableElementsEvents, key)) {
      element = document.querySelector(key);
      eventHandler = clickableElementsEvents[key];
      if (element.addEventListener) {
        element.addEventListener('click', eventHandler, false);
      } else if (element.attachEvent) { // Greetings for IE8
        element.attachEvent('onclick', eventHandler);
      }
    }
  }
}());