const path = require("node:path");

const STAGING_EXCLUDED_TESTS = new Set([
  "tests/ci-engine-release.test.js",
  "tests/conversion.test.js",
  "tests/win7-build-profile.test.js",
  "tests/win7-build-script.test.js",
  "tests/pe-metadata.test.js"
]);

const REQUIRED_RUNTIME_FILES = [
  "src/electron-main.js",
  "src/cli.js",
  "src/agent-skill-installer.js",
  "src/electron-security.js",
  "src/preload.js",
  "src/server.js",
  "src/resource-policy.js",
  "src/pdf-structure-contract.js",
  "src/pdf-structure-score.js",
  "src/pdf-structure-engine.js",
  "src/text-conversion.js",
  "src/office-engine.js",
  "src/office-quality.js",
  "src/diagnostics.js",
  "src/runtime-paths.js",
  "src/image-conversion.js",
  "src/ico-format.js",
  "src/pdf-table-extractor.js",
  "src/pdf-table-runtime.js",
  "ci-engines-v1.json",
  "src/logger.js",
  "src/settings-store.js",
  "src/markdown-assets.js",
  "src/ncm-format.js",
  "src/ncm-metadata.js",
  "src/av3a-format.js",
  "src/kgg-format.js",
  "src/mflac-format.js",
  "src/kgma-format.js",
  "src/kwm-format.js",
  "src/kgm-vpr-format.js",
  "src/config.js",
  "src/utils.js",
  "src/media.js",
  "src/zip-util.js",
  "src/image.js",
  "src/ocr.js",
  "src/pdfjs.js",
  "src/pdf-classifier.js",
  "src/pdf-table.js",
  "src/pdf.js",
  "src/text-docx.js",
  "src/office-convert.js"
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateBasePackage(basePackage, projectRoot) {
  if (!isObject(basePackage)) throw new Error("basePackage must be an object.");
  if (!isObject(basePackage.dependencies)) throw new Error("dependencies must be an object.");
  if (!isObject(basePackage.devDependencies)) throw new Error("devDependencies must be an object.");
  if (!isObject(basePackage.scripts)) throw new Error("scripts must be an object.");
  for (const scriptName of ["test", "test:ci"]) {
    if (typeof basePackage.scripts[scriptName] !== "string") {
      throw new Error(`scripts.${scriptName} must be a string.`);
    }
  }
  if (!isObject(basePackage.build)) throw new Error("build must be an object.");
  if (!Array.isArray(basePackage.build.files) || !basePackage.build.files.every((item) => typeof item === "string")) {
    throw new Error("build.files must be an array of strings.");
  }
  if (!isObject(basePackage.build.win)) throw new Error("build.win must be an object.");
  if (!Array.isArray(basePackage.build.win.extraResources)) {
    throw new Error("build.win.extraResources must be an array.");
  }
  basePackage.build.win.extraResources.forEach((item, index) => {
    if (!isObject(item) || typeof item.from !== "string") {
      throw new Error(`build.win.extraResources[${index}].from must be a string.`);
    }
  });
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new Error("projectRoot must be an absolute path.");
  }
}

function removeStagingExcludedTests(command, scriptName) {
  const invalidMessage = `${scriptName} must use the form node --test <test files>.`;
  if (/[&|;<>`"']|[\r\n\t]/.test(command)) throw new Error(invalidMessage);

  const parts = command.trim().split(/ +/);
  if (
    parts.length < 3 ||
    parts[0] !== "node" ||
    parts[1] !== "--test" ||
    parts.slice(2).some(
      (part) => !/^tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.js$/.test(part)
    )
  ) {
    throw new Error(invalidMessage);
  }

  const testFiles = parts.slice(2).filter((part) => !STAGING_EXCLUDED_TESTS.has(part));
  if (testFiles.length === 0) throw new Error(`${scriptName} has no runtime tests after filtering.`);
  return ["node", "--test", ...testFiles].join(" ");
}

function createWin7Package(basePackage, projectRoot) {
  validateBasePackage(basePackage, projectRoot);

  const profile = cloneJson(basePackage);
  profile.name = "mahiro-format-win7";
  profile.dependencies.sharp = "0.32.6";
  profile.dependencies["pdfjs-dist"] = "2.16.105";
  profile.dependencies.turndown = "7.2.0";
  profile.devDependencies.electron = "22.3.27";

  for (const scriptName of ["test", "test:ci"]) {
    profile.scripts[scriptName] = removeStagingExcludedTests(
      profile.scripts[scriptName],
      `scripts.${scriptName}`
    );
  }
  delete profile.scripts["dist:win7"];

  for (const file of REQUIRED_RUNTIME_FILES) {
    if (!profile.build.files.includes(file)) profile.build.files.push(file);
  }
  profile.build.artifactName = "${productName}-Setup-${version}-win7-${arch}.${ext}";
  profile.build.win.target = ["nsis"];
  delete profile.build.appx;
  // Python-backed docengine and docstructure runtimes are excluded from Win7;
  // their JavaScript boundary modules remain available for static imports.
  profile.build.extraResources = profile.build.win.extraResources
    .filter((item) => ![item.from, item.to].some((value) => /docengine|docstructure/i.test(String(value))))
    .map((item) => ({
      ...item,
      from: item.from.startsWith("bin/")
        ? path.join(projectRoot, ...item.from.split("/"))
        : item.from
    }));
  delete profile.build.win.extraResources;
  delete profile.build.mac;

  return profile;
}

function stageSourceEntries(basePackage) {
  if (!basePackage?.build?.files) {
    throw new Error("Base package is missing electron-builder files.");
  }

  const entries = new Set(["build", "tests", "scripts/lib/win7-build-profile.js", ...REQUIRED_RUNTIME_FILES]);
  for (const pattern of basePackage.build.files) {
    if (pattern === "node_modules" || pattern.startsWith("node_modules/")) continue;
    if (pattern.endsWith("/**/*")) {
      entries.add(pattern.slice(0, -5));
    } else {
      entries.add(pattern);
    }
  }
  entries.delete("package.json");
  return [...entries].sort();
}

function createWin7BuildProfile(basePackage, projectRoot) {
  const packageJson = createWin7Package(basePackage, projectRoot);
  return {
    packageJson,
    stagingEntries: stageSourceEntries(packageJson)
  };
}

module.exports = { createWin7BuildProfile, createWin7Package, stageSourceEntries };
