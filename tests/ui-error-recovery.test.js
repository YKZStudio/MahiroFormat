const assert = require("node:assert/strict");
const { test } = require("node:test");

const { pageHarness } = require("./helpers/ui-page-harness");

test('changing language during a pending conversion preserves progress and translates the active status', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const page = await pageHarness(() => pending);
  await page.select(['one.pdf']);
  const conversion = page.convert();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.find('#progressPanel').hidden, false);
  const progressClass = page.find('#progressPanel').className;
  const language = page.find('#languageSelect'); language.value = 'zh-CN';
  await language.dispatch('change');
  assert.equal(page.find('#progressPanel').hidden, false);
  assert.equal(page.find('#progressPanel').className, progressClass);
  assert.match(page.find('#statusBox').textContent, /正在转换/);
  assert.match(page.find('#progressLabel').textContent, /当前阶段进度/);
  assert.match(page.find('#progressDetails').textContent, /无法估算/);
  assert.equal(page.find('#convertButton').disabled, true);
  finish({ status: 200, body: { fileName: 'one.docx', downloadUrl: '/downloads/one' } });
  await conversion;
  language.value = 'en-US'; await language.dispatch('change');
  assert.equal(page.find('#progressPanel').hidden, false);
  assert.equal(page.find('#progressPercent').textContent, '100%');
  assert.match(page.find('#statusBox').textContent, /1 succeeded/);
  assert.match(page.find('#downloadButton').textContent, /one.docx/);
});

for (const completion of ['saved', 'canceled', 'failed']) {
test(`clear during ${completion} native save retains the whole result until save settles`, async () => {
  let resolveSave, rejectSave;
  const saving = new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
  const id = '9e9e9e9e-1111-4111-8111-111111111111';
  const page = await pageHarness(() => ({ status: 200, body: { fileName: 'one.docx', downloadUrl: `/downloads/${id}` } }), {
    saveConvertedFile: () => saving
  });
  await page.select(['one.pdf']); await page.convert();
  const save = page.find('#downloadButton').dispatch('click');
  await page.find('#clearButton').dispatch('click');
  assert.equal(page.find('#downloadButton').hidden, true);
  assert.deepEqual(page.releasedIds, [], 'native dialog and main/assets transfers still need the result');
  if (completion === 'failed') rejectSave(new Error('disk full'));
  else resolveSave(completion === 'canceled' ? { canceled: true } : { filePath: 'owned-output.docx' });
  await save;
  assert.deepEqual(page.releasedIds, [id]);
});
}

test('batch save protects every discarded ID until its dialog is canceled', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const ids = ['9e9e9e9e-1111-4111-8111-111111111111', '9e9e9e9e-2222-4222-8222-222222222222'];
  const page = await pageHarness((_file, index) => ({ status: 200, body: { fileName: `${index}.docx`, downloadUrl: `/downloads/${ids[index - 1]}` } }), {
    saveConvertedFile: async () => ({ canceled: true }), saveConvertedFiles: () => pending
  });
  await page.select(['one.pdf', 'two.pdf']); await page.convert();
  assert.deepEqual(page.releasedIds, []);
  const save = page.find('#batchSaveButton').dispatch('click');
  await page.find('#clearButton').dispatch('click');
  assert.deepEqual(page.releasedIds, []);
  finish({ canceled: true }); await save;
  assert.deepEqual(page.releasedIds.sort(), ids.sort());
});

test('canceling save of a still-visible result does not discard it', async () => {
  const id = '9e9e9e9e-3333-4333-8333-333333333333';
  const page = await pageHarness(() => ({ status: 200, body: { fileName: 'one.docx', downloadUrl: `/downloads/${id}` } }), {
    saveConvertedFile: async () => ({ canceled: true })
  });
  await page.select(['one.pdf']); await page.convert();
  await page.find('#downloadButton').dispatch('click');
  assert.deepEqual(page.releasedIds, []);
  assert.equal(page.find('#downloadButton').hidden, false);
  assert.match(page.find('#statusBox').textContent, /Not saved yet/);
});

test('concurrent saves of the same discarded result release only after the last save', async () => {
  const finish = [];
  const id = '9e9e9e9e-4444-4444-8444-444444444444';
  const page = await pageHarness(() => ({ status: 200, body: { fileName: 'one.docx', downloadUrl: `/downloads/${id}` } }), {
    saveConvertedFile: () => new Promise(resolve => finish.push(resolve))
  });
  await page.select(['one.pdf']); await page.convert();
  const first = page.find('#downloadButton').dispatch('click');
  const second = page.find('#downloadButton').dispatch('click');
  await page.find('#clearButton').dispatch('click');
  finish[0]({ canceled: true }); await first;
  assert.deepEqual(page.releasedIds, []);
  finish[1]({ canceled: true }); await second;
  assert.deepEqual(page.releasedIds, [id]);
});

for (const failure of ["PDF_STRUCTURE_RESOURCE_LIMIT", "OCR_LOW_CONFIDENCE", "Network connection lost"]) {
test(`${failure} keeps its reason, continues the queue and restores usable controls`, async () => {
  const page = await pageHarness((_file, index) => {
    if (index !== 1) return { status: 200, body: { fileName: "second.docx", downloadUrl: "/downloads/second" } };
    if (failure === "Network connection lost") throw new Error(failure);
    return { status: 422, body: { errorCode: failure, error: "The document could not be converted." } };
  });
  await page.select(["first.pdf", "second.pdf"]);
  await page.convert();
  assert.deepEqual(page.requests, ["first.pdf", "second.pdf"]);
  const rows = page.find("#batchList").children;
  assert.match(rows[0].className, /error/);
  assert.ok(rows[0].textContent.includes(failure));
  assert.match(rows[1].className, /success/);
  assert.match(page.find("#statusBox").textContent, /1 succeeded, 1 failed/);
  for (const id of ["convertButton", "clearButton", "fileInput", "targetSelect"]) assert.equal(page.find(`#${id}`).disabled, false, id);
  assert.equal(page.timers.size, 0);
  assert.equal(page.streams.every(stream => stream.closed), true);
  assert.equal(page.find("#downloadButton").download, "second.docx");
  await page.select(["retry.pdf"]);
  await page.convert();
  assert.deepEqual(page.requests, ["first.pdf", "second.pdf", "retry.pdf"]);
});
}

for (const failAt of ["0%", "100%"]) {
test(`a progress display error at ${failAt} still releases controls, clocks and progress streams`, async () => {
  const page = await pageHarness(() => ({ status: 200, body: { fileName: "one.docx", downloadUrl: "/downloads/one" } }));
  await page.select(["one.pdf"]);
  // Browser/DOM failure at the page boundary, not a stub of setProgress or any
  // application helper. A finally boundary must run even when rendering fails.
  let displayFailure = true;
  Object.defineProperty(page.find("#progressFill").style, "width", { set(value) {
    if (displayFailure && value === failAt) { displayFailure = false; throw new Error("Progress DOM unavailable"); }
  } });
  await assert.rejects(page.convert(), /Progress DOM unavailable/);
  for (const id of ["convertButton", "clearButton", "fileInput", "targetSelect"]) assert.equal(page.find(`#${id}`).disabled, false, id);
  assert.equal(page.timers.size, 0);
  assert.equal(page.streams.every(stream => stream.closed), true);
  await page.find("#clearButton").dispatch("click");
  assert.equal(page.find("#batchList").children.length, 0, "selection can be cleared after the display exception");
});
}
