const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const extensions = new Set([".md", ".html"]);
const ignoredDirectories = new Set([".git", "node_modules", "output", "dist"]);
const ignoredFiles = new Set([path.join("public", "index.html")]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (extensions.has(path.extname(entry.name).toLowerCase())
      && !ignoredFiles.has(path.relative(root, absolute))) files.push(absolute);
  }
  return files;
}

function localTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, "");
  if (!target || target.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|data:|javascript:)/i.test(target)) return null;
  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return null;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function references(content) {
  const searchable = content
    .replace(/(```|~~~)[\s\S]*?\1/g, (value) => " ".repeat(value.length))
    .replace(/`[^`\n]*`/g, (value) => " ".repeat(value.length));
  const result = [];
  for (const match of searchable.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    result.push({ target: match[1], index: match.index });
  }
  for (const match of searchable.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    result.push({ target: match[1], index: match.index });
  }
  return result;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

const errors = [];
for (const file of walk(root)) {
  const content = fs.readFileSync(file, "utf8");
  for (const reference of references(content)) {
    const target = localTarget(reference.target);
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      errors.push(`${path.relative(root, file)}:${lineNumber(content, reference.index)}: missing ${reference.target}`);
    }
  }
}

const languagePairs = [
  ["README.md", "README_zh_CN.md"],
  ["docs/README.md", "docs/README_zh_CN.md"],
  ["docs/ARCHITECTURE.md", "docs/ARCHITECTURE_zh_CN.md"],
  ["docs/RELEASE.md", "docs/RELEASE_zh_CN.md"],
  ["docs/HANDOFF.md", "docs/HANDOFF_zh_CN.md"],
  ["docs/privacy-policy.html", "docs/privacy-policy-zh-CN.html"],
  ["docs/releases/v0.3.5.md", "docs/releases/v0.3.5_zh_CN.md"]
];

for (const [english, chinese] of languagePairs) {
  const englishContent = fs.readFileSync(path.join(root, english), "utf8");
  const chineseContent = fs.readFileSync(path.join(root, chinese), "utf8");
  const englishLink = path.basename(english);
  const chineseLink = path.basename(chinese);
  if (!englishContent.includes(chineseLink)) errors.push(`${english}: missing language link to ${chineseLink}`);
  if (!chineseContent.includes(englishLink)) errors.push(`${chinese}: missing language link to ${englishLink}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Documentation links and language pairs are valid.");
}
