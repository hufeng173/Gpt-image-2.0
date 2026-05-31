import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

import { prepareImageBuffer } from "@/lib/image-files";
import { getAttachmentMaterialSkill } from "@/lib/skills/registry";
import { AttachmentMaterialSchema, type AttachmentKind, type AttachmentMaterial } from "@/lib/skills/types";
import { getAppSettings } from "@/lib/settings";

export type ParsedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  url: string | null;
  storagePath: string;
  summary: string;
  materials: AttachmentMaterial;
  warnings: string[];
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 18000;
const MAX_CSV_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp"]);
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);
const SPREADSHEET_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".ipg", ".webp"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const SPREADSHEET_EXTENSIONS = new Set([".csv", ".xls", ".xlsx"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json"]);

function sanitizeBaseName(name: string) {
  const fallback = "attachment";
  const parsed = path.parse(name || fallback);
  return (parsed.name || fallback)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || fallback;
}

function normalizeMimeType(name: string, mimeType: string) {
  const type = mimeType.toLowerCase();
  const extension = path.extname(name.toLowerCase());

  if (type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
  if (type && type !== "application/octet-stream") return type;

  if (extension === ".jpg" || extension === ".jpeg" || extension === ".jpe" || extension === ".jfif" || extension === ".ipg") {
    return "image/jpeg";
  }
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".doc") return "application/msword";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".csv") return "text/csv";
  if (TEXT_EXTENSIONS.has(extension)) return "text/plain";

  return type || "application/octet-stream";
}

function extensionForFile(name: string, mimeType: string, kind: AttachmentKind) {
  const current = path.extname(name || "").toLowerCase();
  if (current && current.length <= 12) return current;

  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType.includes("wordprocessingml")) return ".docx";
  if (mimeType === "application/msword") return ".doc";
  if (mimeType.includes("spreadsheetml")) return ".xlsx";
  if (mimeType === "application/vnd.ms-excel") return ".xls";
  if (mimeType.includes("csv")) return ".csv";
  if (kind === "TEXT") return ".txt";
  return ".bin";
}

export function getAttachmentKind(name: string, mimeType: string): AttachmentKind {
  const extension = path.extname(name.toLowerCase());
  const type = normalizeMimeType(name, mimeType);

  if (IMAGE_TYPES.has(type) || IMAGE_EXTENSIONS.has(extension)) return "IMAGE";
  if (DOCUMENT_TYPES.has(type) || DOCUMENT_EXTENSIONS.has(extension)) return "DOCUMENT";
  if (SPREADSHEET_TYPES.has(type) || SPREADSHEET_EXTENSIONS.has(extension)) return "SPREADSHEET";
  if (TEXT_TYPES.has(type) || TEXT_EXTENSIONS.has(extension)) return "TEXT";

  return "OTHER";
}

function validateAttachment(kind: AttachmentKind, name: string, mimeType: string, size: number) {
  const extension = path.extname(name.toLowerCase());

  if (kind === "OTHER") {
    throw new Error("暂不支持该文件类型。请上传 JPG/JPEG/PNG/WebP、PDF、DOC/DOCX、XLS/XLSX、CSV、TXT/Markdown。");
  }

  if (kind === "IMAGE" && !IMAGE_TYPES.has(mimeType) && !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("图片仅支持 JPG/JPEG、PNG、WebP。");
  }

  if (kind === "IMAGE" && size > MAX_IMAGE_SIZE) {
    throw new Error("单张图片不能超过 10MB。");
  }

  if (size > MAX_FILE_SIZE) {
    throw new Error("单个附件不能超过 25MB。");
  }
}

function clampText(text: string) {
  const normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_TEXT_CHARS) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, MAX_TEXT_CHARS), truncated: true };
}

async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

function extractLegacyDocText(buffer: Buffer) {
  const ascii = buffer
    .toString("latin1")
    .replace(/\u0000/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\u4e00-\u9fa5]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return ascii.length > 120 ? ascii : "";
}

function extractSpreadsheet(buffer: Buffer, name: string) {
  if (buffer.byteLength > MAX_CSV_BYTES && name.toLowerCase().endsWith(".csv")) {
    throw new Error("CSV 文件过大，请压缩到 8MB 以内。");
  }

  const workbook = XLSX.read(buffer, { type: "buffer", dense: false, cellDates: true });
  const tableMaterials: AttachmentMaterial["tables"] = [];
  const textParts: string[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 8)) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false }).slice(0, 20);
    const columns = rows[0] ? Object.keys(rows[0]).slice(0, 24) : [];
    const sampleRows = rows.slice(0, 6).map((row) =>
      columns
        .slice(0, 8)
        .map((column) => `${column}: ${String(row[column] ?? "").slice(0, 80)}`)
        .join("；"),
    );

    tableMaterials.push({
      name: sheetName,
      columns,
      sampleRows,
      notes: [
        `${sheetName} 包含 ${rows.length} 行预览数据`,
        columns.length ? `字段：${columns.join("、")}` : "未识别到表头",
      ],
    });

    textParts.push(`Sheet ${sheetName}\n字段：${columns.join("、")}\n${sampleRows.join("\n")}`);
  }

  return { text: textParts.join("\n\n"), tables: tableMaterials };
}

async function extractReadableContent(kind: AttachmentKind, buffer: Buffer, name: string, mimeType: string) {
  const warnings: string[] = [];
  const lowerName = name.toLowerCase();

  if (kind === "IMAGE") {
    return { text: "", tables: [], warnings };
  }

  if (kind === "TEXT") {
    const result = clampText(buffer.toString("utf8"));
    if (result.truncated) warnings.push("文本较长，已截取前 18000 个字符用于素材分析。");
    return { text: result.text, tables: [], warnings };
  }

  if (kind === "DOCUMENT") {
    let rawText = "";
    if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
      rawText = await extractPdfText(buffer);
    } else if (lowerName.endsWith(".docx") || mimeType.includes("wordprocessingml")) {
      rawText = await extractDocxText(buffer);
    } else if (lowerName.endsWith(".doc") || mimeType === "application/msword") {
      rawText = extractLegacyDocText(buffer);
      if (!rawText) warnings.push("旧版 DOC 已保存，但无法稳定提取正文。建议转换为 DOCX 后可获得更完整解析。");
    } else {
      throw new Error("暂不支持该文档格式，请上传 PDF、DOC 或 DOCX。");
    }

    const result = clampText(rawText);
    if (result.truncated) warnings.push("文档较长，已截取前 18000 个字符用于素材分析。");
    return { text: result.text, tables: [], warnings };
  }

  if (kind === "SPREADSHEET") {
    const extracted = extractSpreadsheet(buffer, name);
    const result = clampText(extracted.text);
    if (result.truncated) warnings.push("表格内容较长，已截取前 18000 个字符用于素材分析。");
    return { text: result.text, tables: extracted.tables, warnings };
  }

  return { text: "", tables: [], warnings };
}

export async function parseAndStoreAttachment(file: File): Promise<ParsedAttachment> {
  const originalName = file.name || "attachment";
  const mimeType = normalizeMimeType(originalName, file.type || "application/octet-stream");
  const kind = getAttachmentKind(originalName, mimeType);

  validateAttachment(kind, originalName, mimeType, file.size);

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const extension = extensionForFile(originalName, mimeType, kind);
  const baseName = sanitizeBaseName(originalName);
  const fileName = `${Date.now()}-${nanoid(8)}-${baseName}${extension}`;

  let storageRoot = path.join(process.cwd(), "data", "attachments", kind.toLowerCase());
  let publicUrl: string | null = null;
  let finalBuffer: Buffer = sourceBuffer;
  const warnings: string[] = [];

  if (kind === "IMAGE") {
    const prepared = await prepareImageBuffer(sourceBuffer, {
      maxEdge: 4096,
      quality: 92,
      format: mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpeg" : "png",
    });
    finalBuffer = Buffer.from(prepared.buffer);
    storageRoot = path.join(process.cwd(), "public", "uploads", "attachments");
    publicUrl = `/api/uploads/attachments/${fileName}`;
  }

  await mkdir(storageRoot, { recursive: true });
  const storagePath = path.join(storageRoot, fileName);
  await writeFile(storagePath, finalBuffer);

  const readable = await extractReadableContent(kind, sourceBuffer, originalName, mimeType);
  warnings.push(...readable.warnings);

  const skill = getAttachmentMaterialSkill(kind);
  const settings = await getAppSettings();
  const materials = AttachmentMaterialSchema.parse(
    await skill.run({
      name: originalName,
      mimeType,
      kind,
      text: readable.text,
      tables: readable.tables,
      imageUrl: publicUrl,
      size: finalBuffer.length,
      model: settings.promptOptimizerModel,
    }),
  );

  warnings.push(...materials.warnings);

  return {
    name: originalName,
    mimeType,
    size: finalBuffer.length,
    kind,
    url: publicUrl,
    storagePath,
    summary: materials.summary,
    materials,
    warnings: Array.from(new Set(warnings)),
  };
}

export function formatAttachmentsForPrompt(
  attachments: Array<{
    name?: string | null;
    kind?: string | null;
    summary?: string | null;
    materials?: unknown;
  }>,
) {
  const lines = attachments
    .map((attachment, index) => {
      const parsed = AttachmentMaterialSchema.safeParse(attachment.materials);
      const materials = parsed.success ? parsed.data : null;
      const name = attachment.name || `附件 ${index + 1}`;
      const kind = attachment.kind || "ATTACHMENT";
      const hints = materials?.promptHints?.length ? materials.promptHints.join("；") : "";
      const facts = materials?.keyFacts?.length ? materials.keyFacts.join("；") : "";
      const visuals = materials?.visualNotes?.length ? materials.visualNotes.join("；") : "";

      return [
        `${index + 1}. ${name} (${kind})`,
        attachment.summary ? `摘要：${attachment.summary}` : "",
        facts ? `关键信息：${facts}` : "",
        visuals ? `视觉要点：${visuals}` : "",
        hints ? `生图提示：${hints}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);

  if (lines.length === 0) return "";
  return `上传附件素材参考：\n${lines.join("\n\n")}`;
}
