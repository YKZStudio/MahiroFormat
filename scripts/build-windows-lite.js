const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWindowsLiteProfile } = require('./lib/windows-lite-profile');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist', 'lite'));
fs.mkdirSync(output, { recursive: true });
const build = createWindowsLiteProfile(require('../package.json').build);
build.directories = { ...build.directories, output };
const config = path.join(output, 'lite-build.json');
fs.writeFileSync(config, JSON.stringify(build, null, 2));
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'),
  '--win', 'nsis', '--x64', '--publish', 'never', '--config', config], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
