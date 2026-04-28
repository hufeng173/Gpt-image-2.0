import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export type StoredImageFile = {
  url: string;
  filePath: string;
};

export type PublicImageFile = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

function extToMime(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".webp") return "image/webp";
  return "image/png";
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
  const filePath = publicUrlToFilePath(url);
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath);

  return {
    buffer,
    fileName: path.basename(filePath),
    mimeType: extToMime(ext),
  };
}
