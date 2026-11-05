const os = require("node:os");
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

// Admission budgets preserve original pixels/pages; they reject work which
// cannot safely fit instead of silently resizing or dropping content. These
// conservative estimates are not a promise about every native engine's peak.
function calculateResourceLimits({ totalMemory = os.totalmem(), freeMemory = os.freemem() } = {}) {
  const total = Number.isFinite(totalMemory) && totalMemory > 0 ? totalMemory : GiB;
  const free = Number.isFinite(freeMemory) && freeMemory > 0 ? freeMemory : 128 * MiB;
  const workingBytes = Math.max(16 * MiB, Math.min(GiB, Math.floor(total / 4), Math.floor(free / 2)));
  // Decoder, source and destination buffers can coexist, including 16-bit data.
  const maxImagePixels = Math.min(50_000_000, Math.floor(workingBytes / 16));
  return Object.freeze({
    workingBytes,
    maxImagePixels,
    maxImageDimension: 16_384,
    maxImagePdfPixels: 100_000_000,
    maxBatchBytes: 2 * GiB,
    maxUploadBytes: 2 * GiB,
    maxUploadFiles: 1000,
    maxPdfPages: Number.MAX_SAFE_INTEGER
  });
}

const LIMITS = calculateResourceLimits();

const STRUCTURE_LIMITS = Object.freeze({
  maxBlocksPerPage: 5000,
  maxTablesPerPage: 100,
  maxCellsPerTable: 20000,
  maxTotalBlocks: 50000,
  maxTotalTables: 1000,
  maxTotalCells: 200000,
  maxManifestNodes: 1000000,
  maxNestingDepth: 64
});

const MESSAGES = Object.freeze({
  TEXT_INPUT_BUDGET_EXCEEDED: {
    zhCN: "文本转 EPUB 超过当前内存预算（输入最多 {limitMiB} MiB），请拆分文本后重试；原文件未修改。",
    enUS: "Text-to-EPUB exceeds the current memory budget (up to {limitMiB} MiB of input). Split the text and retry; the original is unchanged."
  },
  IMAGE_METADATA_INVALID: {
    zhCN: "无法读取图片尺寸，请确认图片文件完整。",
    enUS: "The image dimensions could not be read. Make sure the image is valid."
  },
  IMAGE_PIXELS_EXCEEDED: {
    zhCN: "图片解码需要的内存超过当前预算（{limitMegapixels} 百万像素），请拆分图片后重试；原文件未修改。",
    enUS: "Image decoding exceeds the current memory budget ({limitMegapixels} megapixels). Split the image and retry; the original is unchanged."
  },
  IMAGE_DIMENSION_EXCEEDED: {
    zhCN: "图片单边尺寸超过当前处理上限（{limitDimension} 像素），请拆分图片后重试。",
    enUS: "An image dimension exceeds the current processing limit ({limitDimension} pixels). Split the image and retry."
  },
  IMAGE_PDF_BUDGET_EXCEEDED: {
    zhCN: "合并图片超过当前内存预算（{limitMegapixels} 百万像素），请分批处理；原图片未压缩。",
    enUS: "The image merge exceeds the current memory budget ({limitMegapixels} megapixels). Use smaller batches; the original images have not been compressed."
  },
  BATCH_BYTES_EXCEEDED: {
    zhCN: "本批文件超过处理预算（{limitGiB} GiB），请分批转换。",
    enUS: "This batch exceeds the processing budget ({limitGiB} GiB). Convert the files in smaller batches."
  },
  BATCH_FILE_SIZE_INVALID: {
    zhCN: "无法确认批量文件大小，已停止处理以保护系统资源。",
    enUS: "A batch file size is invalid. Processing stopped to protect system resources."
  },
  PDF_PAGE_COUNT_INVALID: {
    zhCN: "无法读取 PDF 页数，请确认 PDF 文件完整且未损坏。",
    enUS: "The PDF page count could not be read. Make sure the PDF is valid."
  },
  PDF_PAGE_BUDGET_EXCEEDED: {
    zhCN: "PDF 页数超过当前内存预算（{limitPages} 页），请拆分文档后重试；没有跳过任何页面。",
    enUS: "The PDF exceeds the current memory budget ({limitPages} pages). Split it and retry; no pages have been skipped."
  },
  UPLOAD_DISK_BUDGET_EXCEEDED: {
    zhCN: "临时磁盘空间不足以容纳本次输入及转换结果，请释放空间或分批处理。",
    enUS: "Temporary disk space cannot accommodate this input and its conversion output. Free space or use smaller batches."
  },
  UPLOAD_FILE_COUNT_EXCEEDED: {
    zhCN: "本次上传超过 {limitFiles} 个文件，请分批处理。",
    enUS: "This upload exceeds {limitFiles} files. Use smaller batches."
  },
  UPLOAD_FILE_SIZE_EXCEEDED: {
    zhCN: "单个文件超过本次上传上限（{limitGiB} GiB），请拆分后处理。",
    enUS: "The file exceeds the upload limit ({limitGiB} GiB). Split it before processing."
  }
});

// 把消息里的 {key} 占位符替换为 details 里的值（如 {pages}）
function renderMessage(text, details) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    details[key] != null ? String(details[key]) : match
  );
}

class ResourceLimitError extends Error {
  constructor(errorCode, details = {}) {
    details = {
      limitMegapixels: Math.floor((errorCode === "IMAGE_PDF_BUDGET_EXCEEDED" ? LIMITS.maxImagePdfPixels : LIMITS.maxImagePixels) / 100000) / 10,
      limitDimension: LIMITS.maxImageDimension,
      limitGiB: (errorCode === "UPLOAD_FILE_SIZE_EXCEEDED" ? LIMITS.maxUploadBytes : LIMITS.maxBatchBytes) / GiB,
      limitPages: LIMITS.maxPdfPages,
      limitFiles: LIMITS.maxUploadFiles,
      ...details
    };
    const messages = MESSAGES[errorCode] || {
      zhCN: "文件超出资源限制。",
      enUS: "The file exceeds a resource limit."
    };
    super(renderMessage(messages.zhCN, details));
    this.name = "ResourceLimitError";
    this.errorCode = errorCode;
    this.messages = {
      zhCN: renderMessage(messages.zhCN, details),
      enUS: renderMessage(messages.enUS, details)
    };
    this.details = details;
  }
}

function positiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function imageDecodedPixels(metadata) {
  const width = positiveInteger(metadata?.width);
  const height = positiveInteger(metadata?.height);
  if (!width || !height) throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  const pages = positiveInteger(metadata?.pages) || 1;
  const declaredPageHeight = metadata?.pageHeight == null ? 0 : positiveInteger(metadata.pageHeight);
  if (metadata?.pageHeight != null && !declaredPageHeight) {
    throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  }
  if (height % pages !== 0) throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  const frameHeight = declaredPageHeight || (height / pages);
  if (frameHeight * pages !== height) throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  const pixels = width * frameHeight * pages;
  if (!Number.isSafeInteger(pixels)) throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  return pixels;
}

function assertImageMetadata(metadata, limits = LIMITS) {
  const width = positiveInteger(metadata?.width);
  const totalHeight = positiveInteger(metadata?.height);
  if (!width || !totalHeight) throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  const pages = positiveInteger(metadata?.pages) || 1;
  const frameHeight = positiveInteger(metadata?.pageHeight) || (totalHeight % pages === 0 ? totalHeight / pages : 0);
  if (!frameHeight || frameHeight * pages !== totalHeight) {
    throw new ResourceLimitError("IMAGE_METADATA_INVALID");
  }
  if (width > limits.maxImageDimension || frameHeight > limits.maxImageDimension) {
    throw new ResourceLimitError("IMAGE_DIMENSION_EXCEEDED", { width, height: frameHeight, limitDimension: limits.maxImageDimension });
  }
  const pixels = imageDecodedPixels(metadata);
  if (pixels > limits.maxImagePixels) {
    throw new ResourceLimitError("IMAGE_PIXELS_EXCEEDED", { pixels, limitMegapixels: Math.floor(limits.maxImagePixels / 100000) / 10 });
  }
  return pixels;
}

function assertImagePdfBudget(metadataList, limits = LIMITS) {
  let total = 0;
  for (const metadata of metadataList || []) {
    total += assertImageMetadata(metadata, limits);
    if (!Number.isSafeInteger(total) || total > limits.maxImagePdfPixels) {
      throw new ResourceLimitError("IMAGE_PDF_BUDGET_EXCEEDED", { pixels: total, limitMegapixels: Math.floor(limits.maxImagePdfPixels / 100000) / 10 });
    }
  }
  return total;
}

function assertBatchBytes(files, limits = LIMITS) {
  let total = 0;
  for (const file of files || []) {
    if (typeof file?.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new ResourceLimitError("BATCH_FILE_SIZE_INVALID");
    }
    total += file.size;
    if (!Number.isSafeInteger(total)) throw new ResourceLimitError("BATCH_FILE_SIZE_INVALID");
  }
  if (total > limits.maxBatchBytes) {
    throw new ResourceLimitError("BATCH_BYTES_EXCEEDED", { bytes: total, limitGiB: limits.maxBatchBytes / GiB });
  }
  return total;
}

function assertPdfPages(pageCount, { limits = LIMITS } = {}) {
  const count = positiveInteger(pageCount);
  if (!count) throw new ResourceLimitError("PDF_PAGE_COUNT_INVALID");
  if (count > limits.maxPdfPages) throw new ResourceLimitError("PDF_PAGE_BUDGET_EXCEEDED", { pages: count, limitPages: limits.maxPdfPages });
  return count;
}

module.exports = {
  LIMITS,
  calculateResourceLimits,
  STRUCTURE_LIMITS,
  ResourceLimitError,
  imageDecodedPixels,
  assertImageMetadata,
  assertImagePdfBudget,
  assertBatchBytes,
  assertPdfPages
};
