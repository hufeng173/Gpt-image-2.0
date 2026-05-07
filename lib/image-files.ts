import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";

export type StoredImageFile = {
  url: string;
  filePath: string;
};

export type PublicImageFile = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

export type PreparedImageFile = PublicImageFile & {
  width: number | null;
  height: number | null;
};

function extToMime(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".webp") return "image/webp";
  return "image/png";
}

function assertSafeFilename(filename: string) {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Invalid image filename.");
  }
}

export function localImageUrlToFilePath(url: string): string {
  if (url.startsWith("/api/generated/")) {
    const filename = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "");
    assertSafeFilename(filename);
    return path.join(process.cwd(), "data", "generated", filename);
  }

  if (url.startsWith("/api/uploads/")) {
    const parts = decodeURIComponent(url.split("?")[0]).split("/").filter(Boolean);
    const [api, uploads, category, filename] = parts;

    if (api !== "api" || uploads !== "uploads" || !category || !filename) {
      throw new Error("Invalid upload image path.");
    }

    if (!['composition', 'color', 'material', 'lighting', 'other'].includes(category)) {
      throw new Error("Invalid upload image category.");
    }

    assertSafeFilename(filename);
    return path.join(process.cwd(), "public", "uploads", category, filename);
  }

  if (url.startsWith("/uploads/")) {
    const cleanUrl = decodeURIComponent(url.split("?")[0]).replace(/^\/+/, "");
    return path.join(process.cwd(), "public", cleanUrl);
  }

  return publicUrlToFilePath(url);
}

export async function saveBase64Image(base64: string, jobId: string, index: number): Promise<StoredImageFile> {
  const outputDir = path.join(process.cwd(), "public", "generated");
  await mkdir(outputDir, { recursive: true });

  const fileName = `${jobId}-${index + 1}-${nanoid(8)}.png`;
  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, Buffer.from(base64, "base64"));

  return {
    url: `/generated/${fileName}`,
    filePath,
  };
}

export function publicUrlToFilePath(url: string): string {
  if (!url.startsWith("/")) {
    throw new Error("Only local public image urls are supported as edit references.");
  }

  const cleanUrl = decodeURIComponent(url.split("?")[0]).replace(/^\/+/, "");
  const publicRoot = path.join(process.cwd(), "public");
  const filePath = path.join(publicRoot, cleanUrl);

  if (!filePath.startsWith(publicRoot)) {
    throw new Error("Invalid public image path.");
  }

  return filePath;
}

export async function readPublicImage(url: string): Promise<PublicImageFile> {
  const filePath = localImageUrlToFilePath(url);
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath);

  return {
    buffer,
    fileName: path.basename(filePath),
    mimeType: extToMime(ext),
  };
}

export async function prepareImageBuffer(input: Buffer, options?: {
  maxEdge?: number;
  quality?: number;
  format?: "png" | "jpeg" | "webp";
}): Promise<PreparedImageFile> {
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error("图片文件无效或已损坏。");
  }

  const maxEdge = options?.maxEdge || 1536;
  const quality = options?.quality || 88;
  const format = options?.format || "png";
  const needsResize = Math.max(metadata.width, metadata.height) > maxEdge;
  let pipeline = sharp(input, { failOn: "error" }).rotate();

  if (needsResize) {
    pipeline = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const buffer = format === "jpeg"
    ? await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
    : format === "webp"
      ? await pipeline.webp({ quality }).toBuffer()
      : await pipeline.png().toBuffer();

  const finalMetadata = await sharp(buffer).metadata();

  return {
    buffer,
    fileName: `prepared.${format === "jpeg" ? "jpg" : format}`,
    mimeType: format === "jpeg" ? "image/jpeg" : `image/${format}`,
    width: finalMetadata.width ?? null,
    height: finalMetadata.height ?? null,
  };
}

export async function readPreparedLocalImage(url: string, options?: {
  maxEdge?: number;
  quality?: number;
  format?: "png" | "jpeg" | "webp";
}): Promise<PreparedImageFile> {
  const image = await readPublicImage(url);
  const prepared = await prepareImageBuffer(image.buffer, options);
  return {
    ...prepared,
    fileName: image.fileName,
  };
}

export async function localImageUrlToDataUrl(url: string, options?: {
  maxEdge?: number;
  quality?: number;
  format?: "png" | "jpeg" | "webp";
}): Promise<string> {
  const image = await readPreparedLocalImage(url, options);
  return `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
}
