import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { assertWritableRequest } from "@/lib/request-guard";
import { prepareImageBuffer } from "@/lib/image-files";
import { requireAccessSession } from "@/lib/access-control";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_CATEGORIES = new Set(["composition", "color", "material", "lighting", "other"]);

function extensionFromType(type: string) {
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  return ".png";
}

export async function POST(request: NextRequest) {
  try {
    assertWritableRequest(request);
    await requireAccessSession(request);

    const formData = await request.formData();
    const files = formData.getAll("files");
    const categoryValue = String(formData.get("category") || "other");
    const category = ALLOWED_CATEGORIES.has(categoryValue) ? categoryValue : "other";

    const uploadDir = path.join(process.cwd(), "public", "uploads", category);
    await mkdir(uploadDir, { recursive: true });

    const uploaded = [];
    const rejected: Array<{ name: string; reason: string }> = [];

    for (const item of files) {
      if (!(item instanceof File)) continue;
      if (!ALLOWED_TYPES.has(item.type)) {
        rejected.push({ name: item.name || "unknown", reason: "仅支持 PNG、JPEG、WebP 图片。" });
        continue;
      }
      if (item.size > MAX_FILE_SIZE) {
        rejected.push({ name: item.name || "unknown", reason: "单张图片不能超过 10MB。" });
        continue;
      }

      const sourceBuffer = Buffer.from(await item.arrayBuffer());
      let prepared;

      try {
        prepared = await prepareImageBuffer(sourceBuffer, {
          maxEdge: 4096,
          quality: 92,
          format: item.type === "image/webp" ? "webp" : item.type === "image/jpeg" ? "jpeg" : "png",
        });
      } catch {
        rejected.push({ name: item.name || "unknown", reason: "图片文件无效或已损坏。" });
        continue;
      }

      const fileName = `${Date.now()}-${nanoid(8)}${extensionFromType(item.type)}`;
      const filePath = path.join(uploadDir, fileName);
      await writeFile(filePath, prepared.buffer);

      uploaded.push({
        url: `/api/uploads/${category}/${fileName}`,
        name: item.name,
        type: item.type,
        size: prepared.buffer.length,
        category,
      });
    }

    return NextResponse.json({
      ok: uploaded.length > 0,
      files: uploaded,
      rejected,
      message: uploaded.length > 0 ? undefined : rejected[0]?.reason || "没有可上传的图片。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    const status = message.includes("无权") || message.includes("跨站") ? 403 : 400;

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status },
    );
  }
}
