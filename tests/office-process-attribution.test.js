"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { officeProcessesForRuntime } = require("./helpers/office-processes");

test("Office leak assertion includes only the exact isolated runtime profiles", () => {
  const root = path.join(os.tmpdir(), "fm office 中文");
  const row = (pid, folder) => ({Name:"soffice.bin", ProcessId:pid, ParentProcessId:100,
    CommandLine:`soffice.com "-env:UserInstallation=${pathToFileURL(path.join(folder, "office-123456", "p")).href}" --headless`});
  const rows = [row(101, root), row(102, `${root}-unrelated`), row(103, path.join(os.tmpdir(), "another-office")),
    {Name:"soffice.bin", ProcessId:104, CommandLine:"soffice --headless"}];
  assert.deepEqual(officeProcessesForRuntime(rows, root).map(item=>item.pid), [101]);
  assert.deepEqual(officeProcessesForRuntime(rows.slice(1), root), []);
});
