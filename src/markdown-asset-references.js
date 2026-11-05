// Locate destinations in the original CommonMark source. Never serialize an AST:
// that would normalize code, whitespace, escapes, titles and CRLF line endings.
const path = require("node:path");
const { parser, GFM } = require("@lezer/markdown");
const { parseFragment } = require("parse5");

const markdownParser = parser.configure(GFM);
const RAW_HTML = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext", "pre", "code", "template"]);
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

function decodedDestination(raw, markdown) {
  let value = "";
  const offsets = [];
  for (let index = 0; index < raw.length;) {
    const start = index;
    let text = raw[index++];
    if (markdown && text === "\\" && PUNCTUATION.test(raw[index] || "")) {
      text = raw[index++];
    } else if (text === "&") {
      const expression = markdown
        ? /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);/
        : /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);?/;
      const entity = expression.exec(raw.slice(start));
      if (entity) {
        // Attribute character references have different rules from Markdown
        // text (notably semicolon-less references before '='). Use the HTML
        // parser's attribute context rather than a partial entity lookup table.
        const suffix = !markdown && raw[start + entity[0].length] === "=" ? "=" : "";
        const fragment = parseFragment(markdown ? entity[0] : `<a href="${entity[0]}${suffix}">`);
        text = markdown ? fragment.childNodes.map((node) => node.value || "").join("")
          : fragment.childNodes[0].attrs[0].value.slice(0, suffix ? -1 : undefined);
        index = start + entity[0].length;
      }
    }
    value += text;
    for (let position = 0; position < text.length; position++) offsets.push(start);
  }
  return { value, offsets };
}

function maskContainerMarks(source, from, to, marks) {
  const relevant = marks.filter((mark) => mark.from >= from && mark.to <= to);
  if (!relevant.length) return source.slice(from, to);
  const characters = source.slice(from, to).split("");
  for (const mark of relevant) characters.fill(" ", mark.from - from, mark.to - from);
  return characters.join("");
}

function htmlReferences(source, region, marks, protectedRanges) {
  const html = maskContainerMarks(source, region.from, region.to, marks);
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const references = [];
  function visit(node) {
    const location = node.sourceCodeLocation;
    if (RAW_HTML.has(node.tagName) && location) {
      const end = location.endTag?.endOffset;
      if (end === undefined) {
        // Inline HTML is tokenized one tag at a time. Let the HTML parser find
        // the matching end tag in the remaining source, including nested code
        // or template elements; do not guess it with a closing-tag regex.
        const from = region.from + location.startOffset;
        const remainder = maskContainerMarks(source, from, source.length, marks);
        const extended = parseFragment(remainder, { sourceCodeLocationInfo: true }).childNodes
          .find((entry) => entry.sourceCodeLocation?.startOffset === 0 && entry.tagName === node.tagName);
        const closingOffset = extended?.sourceCodeLocation?.endTag?.endOffset;
        protectedRanges.push({ from, to: closingOffset === undefined ? source.length : from + closingOffset });
      } else {
        protectedRanges.push({ from: region.from + location.startOffset, to: region.from + end });
      }
      return;
    }
    // Generated Markdown uses images and anchor links. Other HTML attributes,
    // including titles, data-* and script strings, are not attachment references.
    const attributeName = node.tagName === "img" ? "src" : node.tagName === "a" ? "href" : null;
    const attribute = attributeName && node.attrs?.find((entry) => entry.name === attributeName);
    const attributeLocation = attribute && location?.attrs?.[attributeName];
    if (attributeLocation) {
      const raw = html.slice(attributeLocation.startOffset, attributeLocation.endOffset);
      const prefix = /^[^\s=]+\s*=\s*/.exec(raw);
      if (prefix) {
        let from = attributeLocation.startOffset + prefix[0].length;
        let to = attributeLocation.endOffset;
        if (html[from] === '"' || html[from] === "'") { from++; to--; }
        // Browsers ignore whitespace surrounding an HTML URL. Preserve it in
        // source while changing only the path itself.
        while (from < to && /\s/.test(html[from])) from++;
        while (to > from && /\s/.test(html[to - 1])) to--;
        references.push({ from: region.from + from, to: region.from + to, markdown: false });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  for (const child of fragment.childNodes) visit(child);
  return references;
}

function destinationRanges(source) {
  const references = [], htmlRegions = [], marks = [], protectedRanges = [];
  const definitions = new Set();
  const tree = markdownParser.parse(source);
  const cursor = tree.cursor();
  do {
    const node = cursor.node;
    if (node.name === "QuoteMark" || node.name === "ListMark") marks.push({ from: node.from, to: node.to });
    if (node.name === "HTMLBlock" || node.name === "HTMLTag") htmlRegions.push({ from: node.from, to: node.to });
    if (node.name !== "URL" || !["Link", "Image", "LinkReference"].includes(node.parent?.name)) continue;
    if (node.parent.name === "LinkReference") {
      const label = node.parent.getChild("LinkLabel");
      const key = source.slice(label.from + 1, label.to - 1).trim().replace(/\s+/g, " ").toUpperCase();
      if (definitions.has(key)) continue;
      definitions.add(key);
    }
    let { from, to } = node;
    if (source[from] === "<" && source[to - 1] === ">") { from++; to--; }
    references.push({ from, to, markdown: true });
  } while (cursor.next());
  for (const region of htmlRegions) references.push(...htmlReferences(source, region, marks, protectedRanges));
  return references.filter((reference) => !protectedRanges.some((range) => reference.from >= range.from && reference.from < range.to));
}

function rewriteAssetReferences(markdown, originalFileName, assets, directoryName) {
  const base = `${path.parse(path.basename(originalFileName)).name}.assets`;
  const names = new Map(assets.map((asset) => [asset.name, asset]));
  const edits = [];
  for (const reference of destinationRanges(markdown)) {
    const raw = markdown.slice(reference.from, reference.to);
    const decoded = decodedDestination(raw, reference.markdown);
    const separator = decoded.value.search(/[?#]/);
    const encodedPath = separator < 0 ? decoded.value : decoded.value.slice(0, separator);
    let pathname;
    try { pathname = decodeURIComponent(encodedPath); }
    catch {
      if (encodedPath.startsWith(`${base}/`)) throw new Error("保存失败：Markdown 引用的附件不完整，请重新转换后保存。");
      continue;
    }
    // Do not rewrite remote URLs or unrelated relative paths that happen to
    // contain the generated sidecar name.
    pathname = pathname.replace(/^(?:\.\/)+/, "");
    if (!pathname.startsWith(`${base}/`)) continue;
    const name = pathname.slice(base.length + 1);
    if (!names.has(name) || /[\\/\0]/.test(name)) {
      throw new Error("保存失败：Markdown 引用的附件不完整，请重新转换后保存。");
    }
    const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const suffix = separator < 0 ? "" : raw.slice(decoded.offsets[separator]);
    edits.push({ ...reference, replacement: `${directoryName}/${encodedName}${suffix}` });
  }
  edits.sort((left, right) => right.from - left.from);
  let rewritten = markdown;
  let previousFrom = markdown.length;
  for (const edit of edits) {
    if (edit.to > previousFrom) throw new Error("保存失败：Markdown 附件引用位置重叠。");
    rewritten = rewritten.slice(0, edit.from) + edit.replacement + rewritten.slice(edit.to);
    previousFrom = edit.from;
  }
  return rewritten;
}

module.exports = { rewriteAssetReferences };
