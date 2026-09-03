const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function renderer(fetch) {
  let articles = 0;
  class Element {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.value = "";
      this.textContent = "";
      this.hidden = false;
      this.parent = null;
      if (tag === "article") articles += 1;
    }
    append(...children) {
      for (const child of children) { child.parent = this; this.children.push(child); }
      if (this.tagName === "select" && !this.value && children.length) this.value = children[0].value;
    }
    replaceChildren(...children) { this.children = []; this.value = ""; this.append(...children); }
    replaceWith(child) {
      child.parent = this.parent;
      this.parent.children[this.parent.children.indexOf(this)] = child;
      this.parent = null;
    }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    addEventListener() {}
    querySelectorAll() { return []; }
    focus() {}
  }
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element(selector === "#targetSelect" ? "select" : "div"));
      return elements.get(selector);
    },
    querySelectorAll: () => [],
    createElement: (tag) => new Element(tag),
    addEventListener() {}, body: new Element(), documentElement: new Element()
  };
  const context = vm.createContext({
    document, fetch, Headers, console,
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { language: "en-US" },
    window: {
      addEventListener() {},
      FlyingMouseConversionPreferences: require("../public/conversion-preferences"),
      FlyingMouseI18n: require("../public/i18n")
    }
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  // Exercise the real renderer functions and event registration, without startup I/O.
  vm.runInContext(source.replace("initializeApp().catch", "Promise.resolve().catch"), context);
  const api = vm.runInContext("({ state, acceptFiles, clearFile, loadTargetsForFiles, commonTargetsFrom, renderBatchList, setBatchResult, moveFileInQueue, convertMergedImagesToPdf, convertMergedPdfs })", context);
  api.state.sessionToken = "test-session";
  return { ...api, context, elements, get articles() { return articles; } };
}

function response(extension, targets = ["pdf", "png"]) {
  return { ok: true, json: async () => ({ extension, category: "image", targets, experimental: false }) };
}

const file = (name) => ({ name, size: 12, type: "image/png" });

test("batch target requests are shared by normalized extension and preserve input order", async () => {
  const calls = [];
  const ui = renderer(async (_url, options) => {
    const extension = JSON.parse(options.body).extension;
    calls.push(extension);
    return response(extension === "jpeg" ? "jpg" : extension, extension === "png" ? ["pdf"] : ["pdf", "png"]);
  });
  const files = [file("a.jpeg"), file("b.JPG"), file("c.png"), { isBlankPage: true }, file("d.jpg")];
  const infos = await ui.loadTargetsForFiles(files);
  assert.equal(calls.length, 2);
  assert.deepEqual(Array.from(infos, (info) => info.extension), ["jpg", "jpg", "png", "", "jpg"]);
  assert.deepEqual(Array.from(ui.commonTargetsFrom(infos)), ["pdf"]);
  await ui.loadTargetsForFiles(files);
  assert.equal(calls.length, 4, "a later selection performs fresh detection");
});

test("failed target requests are shared for a batch and retried for a new selection", async () => {
  let calls = 0;
  const ui = renderer(async () => { calls += 1; return { ok: false }; });
  const files = [file("a.png"), file("b.png")];
  await assert.rejects(ui.loadTargetsForFiles(files));
  assert.equal(calls, 1);
  await assert.rejects(ui.loadTargetsForFiles(files));
  assert.equal(calls, 2);
});

test("late detection success or failure cannot overwrite a newer selection", async () => {
  for (const fail of [false, true]) {
    const pending = [];
    const ui = renderer(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const first = ui.acceptFiles([file("old.png")]);
    const second = ui.acceptFiles([file("new.jpg")]);
    pending[1].resolve(response("jpg", ["pdf"]));
    await second;
    const status = ui.elements.get("#statusBox").textContent;
    if (fail) pending[0].reject(new Error("old failure"));
    else pending[0].resolve(response("png", ["jpg"]));
    await first;
    assert.equal(ui.state.files[0].name, "new.jpg");
    assert.equal(ui.state.fileInfos[0].extension, "jpg");
    assert.equal(ui.elements.get("#statusBox").textContent, status);
  }
});

test("clearing files invalidates pending target detection", async () => {
  let finish;
  const ui = renderer(() => new Promise((resolve) => { finish = resolve; }));
  const pending = ui.acceptFiles([file("old.png")]);
  ui.clearFile();
  finish(response("png"));
  await pending;
  assert.equal(ui.state.files.length, 0);
  assert.equal(ui.state.fileInfos.length, 0);
  assert.equal(ui.elements.get("#convertButton").disabled, true);
});

test("conversion updates only the changed row while retaining save and preview actions", () => {
  const ui = renderer();
  const count = 200;
  ui.state.files = Array.from({ length: count }, (_, index) => file(`图片-${index}.png`));
  ui.state.isConverting = true;
  ui.renderBatchList();
  const list = ui.elements.get("#batchList");
  const untouched = list.children[0];
  const before = ui.articles;
  for (let index = 1; index < count; index += 1) {
    ui.setBatchResult(index, { status: "success", result: { fileName: `${index}.jpg` } });
  }
  assert.equal(ui.articles - before, count - 1);
  assert.equal(list.children[0], untouched, "unrelated row identity/focus is preserved");
  const actions = list.children[1].children[1].children;
  assert.equal(actions.some((item) => item.dataset.previewIndex === "1"), true);
  assert.equal(actions.some((item) => item.dataset.saveIndex === "1"), true);
});

test("image queue reorder controls still follow file order and disappear after success", async () => {
  const ui = renderer(async () => response("png", ["pdf"]));
  await ui.acceptFiles([file("a.png"), file("b.png")]);
  const actions = () => ui.elements.get("#batchList").children[0].children[1].children;
  assert.equal(actions()[0].disabled, true);
  ui.moveFileInQueue(1, "up");
  assert.equal(ui.state.files[0].name, "b.png");
  ui.setBatchResult(0, { status: "success" });
  assert.equal(actions().some((item) => item.dataset.move !== undefined), false);
});

test("merged conversion initializes all rows in one render", async () => {
  for (const method of ["convertMergedImagesToPdf", "convertMergedPdfs"]) {
    const ui = renderer();
    ui.state.files = Array.from({ length: 100 }, (_, index) => file(`${index}.png`));
    ui.state.isConverting = true;
    vm.runInContext("convertImagesToPdf = convertPdfsToMerged = async () => ({fileName: 'merged.pdf', downloadUrl: '/download/result'})", ui.context);
    const before = ui.articles;
    await ui[method]();
    assert.equal(ui.articles - before, 200, "one initial render and one final render");
    assert.equal(ui.state.batchResults[0].status, "success");
    assert.equal(ui.state.batchResults[1].result, null);
  }
});
