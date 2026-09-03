const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Isolate dependency injection without changing the process-wide require cache.
function loadWithOverrides(filename, overrides = {}) {
  const originalRequire = createRequire(filename);
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : originalRequire(name);
  localRequire.resolve = originalRequire.resolve;
  const loaded = { exports: {} };
  const evaluate = vm.compileFunction(fs.readFileSync(filename, "utf8"),
    ["require", "module", "exports", "__filename", "__dirname"], { filename });
  evaluate(localRequire, loaded, loaded.exports, filename, path.dirname(filename));
  return loaded.exports;
}

module.exports = { loadWithOverrides };
