const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWindowsLiteProfile } = require('../scripts/lib/windows-lite-profile');
test('optional lite build removes only the advanced structure engine and marks the edition', () => {
  const base = require('../package.json').build;
  const before = JSON.stringify(base);
  const lite = createWindowsLiteProfile(base);
  assert.equal(lite.extraMetadata.engineProfile, 'lite');
  assert.deepEqual(lite.win.extraResources, base.win.extraResources.filter(item => item.to !== 'docstructure'));
  for (const engine of ['ffmpeg', 'libreoffice', 'poppler', 'tessdata', 'docengine', 'pandoc']) {
    assert.ok(lite.win.extraResources.some(item => item.to.startsWith(engine)));
  }
  assert.equal(JSON.stringify(base), before);
});
