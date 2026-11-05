const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { convertSubtitle } = require("../src/subtitles");

const srt = "1\n00:00:01,120 --> 00:00:03,450\n你好, world！\n第二行：474.00\n\n2\n01:02:03,400 --> 01:02:05,600\n再见 🌍\n";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fm-subtitle-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return async (source, inputExt, target) => {
    const input = path.join(dir, `source.${inputExt}`);
    const output = path.join(dir, `result.${target}`);
    await fs.writeFile(input, source);
    await fs.rm(output, { force: true });
    const result = await convertSubtitle(input, output, inputExt, target);
    return { ...result, text: await fs.readFile(output, "utf8") };
  };
}

test("all subtitle pairs round trip time, Unicode, multiple lines and commas", async (t) => {
  const convert = await fixture(t);
  const sources = {};
  for (const ext of ["srt", "vtt", "ass", "ssa"]) sources[ext] = (await convert(srt, "srt", ext)).text;
  // File I/O is sequential: every conversion writes a genuine output, read back
  // through a different parser before comparing meaning to the initial SRT.
  for (const [sourceExt, source] of Object.entries(sources)) {
    for (const target of ["srt", "vtt", "ass", "ssa", "txt"]) {
      const result = await convert(source, sourceExt, target);
      assert.ok(result.text.includes("你好, world！"), `${sourceExt} -> ${target}`);
      assert.ok(result.text.includes("再见 🌍"), `${sourceExt} -> ${target}`);
      const plain = target === "txt" ? result : await convert(result.text, target, "txt");
      assert.equal(plain.text, "你好, world！\n第二行：474.00\n\n再见 🌍\n");
      if (target !== "txt") {
        const timed = await convert(result.text, target, "srt");
        assert.match(timed.text, /00:00:01,120 --> 00:00:03,450/);
        assert.match(timed.text, /01:02:03,400 --> 01:02:05,600/);
      }
    }
  }
});

test("VTT cue identifiers, settings, voice and styling produce explicit warnings", async (t) => {
  const convert = await fixture(t);
  const result = await convert("WEBVTT\n\nNOTE authored sample\nnot a subtitle\n\nSTYLE\n::cue { color: red; }\n\nid-1\n00:01.120 --> 00:03.450 align:start position:10%\n<v 张三><b>你好</b>, world &amp; friends\n", "vtt", "srt");
  assert.match(result.text, /你好, world &amp; friends/);
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_STYLE_LOSS"));
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_POSITION_LOSS"));
  assert.ok(result.warnings.every(w => w.messages.zhCN && w.messages.enUS));
});

test("ASS milliseconds round to centiseconds with explicit precision warning", async (t) => {
  const convert = await fixture(t);
  const result = await convert(srt.replace("01,120", "01,125"), "srt", "ass");
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_TIME_PRECISION_LOSS"));
  assert.match(result.text, /0:00:01\.13,0:00:03\.45/);
});

test("SRT styling and braces survive as literal text in TXT; dangerous ASS text is rejected", async (t) => {
  const convert = await fixture(t);
  const result = await convert("1\n00:00:00,000 --> 00:00:01,000\n<b>中文</b> {\\p1} &lt;literal&gt;\n", "srt", "txt");
  assert.equal(result.text, "中文 {\\p1} <literal>\n");
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_STYLE_LOSS"));
  await assert.rejects(convert("1\n00:00:00,000 --> 00:00:01,000\n{\\p1}\n", "srt", "ass"), { code: "SUBTITLE_UNSUPPORTED_CONTENT" });
});

test("ASS drawing, unknown events, incomplete events and invalid timelines fail explicitly", async (t) => {
  const convert = await fixture(t);
  const ass = "[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
  const cases = [
    ["srt", "1\n00:00:03,000 --> 00:00:01,000\nwrong\n", "SUBTITLE_INVALID_TIMING"],
    ["srt", "1\n00:61:00,000 --> 02:00:00,000\nwrong\n", "SUBTITLE_INVALID_TIMING"],
    ["srt", "1\n00:00:01,000 --> 00:00:02,000\nvalid\n\nbroken cue\n", "SUBTITLE_PARSE_FAILED"],
    ["vtt", "WEBVTT\n\nunknown block\n", "SUBTITLE_PARSE_FAILED"],
    ["ass", ass + "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\p1}m 0 0 l 20 20", "SUBTITLE_UNSUPPORTED_CONTENT"],
    ["ass", ass + "Picture: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,image", "SUBTITLE_UNSUPPORTED_CONTENT"],
    ["ass", ass + "Dialogue: 0,0:00:00.00,0:00:01.00", "SUBTITLE_PARSE_FAILED"]
  ];
  for (const [ext, text, code] of cases) {
    await assert.rejects(convert(text, ext, "txt"), error => Boolean(error.code === code && error.messages.zhCN && error.messages.enUS));
  }
});

test("ASS overrides, margins and metadata warn while dialogue commas and line breaks remain", async (t) => {
  const convert = await fixture(t);
  const input = "[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 1,0:00:00.00,0:00:02.00,Fancy,Speaker,0010,0020,0000,,{\\pos(10,20)\\b1}你好, a,b\\N下一行\\h末尾\n";
  const result = await convert(input, "ass", "txt");
  assert.equal(result.text, "你好, a,b\n下一行\u00a0末尾\n");
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_POSITION_LOSS"));
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_STYLE_LOSS"));
  assert.ok(result.warnings.some(w => w.code === "SUBTITLE_TIMING_REMOVED"));
});

test("BOM Unicode files decode explicitly, invalid UTF-8 is not exported as replacement glyphs", async (t) => {
  const convert = await fixture(t);
  const little = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(srt, "utf16le")]);
  const result = await convert(little, "srt", "txt");
  assert.match(result.text, /你好/);
  const big = Buffer.from(little);
  big.swap16();
  assert.equal((await convert(big, "srt", "txt")).text, result.text);
  await assert.rejects(convert(Buffer.from([0x81, 0xff, 0xfe]), "srt", "txt"), { code: "SUBTITLE_ENCODING_UNSUPPORTED" });
});

test("same-format conversion preserves VTT style and metadata after validation", async (t) => {
  const convert = await fixture(t);
  const input = "WEBVTT\n\nSTYLE\n::cue { color: red; }\n\nID\n00:01.000 --> 00:02.000 position:20%\n<b>Hello</b>\n";
  const result = await convert(input, "vtt", "vtt");
  assert.equal(result.text, input);
  assert.deepEqual(result.warnings, []);
});
