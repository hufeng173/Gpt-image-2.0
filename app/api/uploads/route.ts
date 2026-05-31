import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

import { assertWritableRequest } from "@/lib/request-guard";
import { prepareImageBuffer } from "@/lib/image-files";
import { requireAccessSession } from "@/lib/access-control";
import { parseAndStoreAttachment } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_REFERENCE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp"]);
const ALLOWED_REFERENCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".ipg", ".webp"]);
const ALLOWED_CATEGORIES = new Set(["composition", "color", "material", "lighting", "other"]);

function normalizeImageType(name: string, type: string) {
  const extension = path.extname(name.toLowerCase());
  if (type === "image/jpg" || type === "image/pjpeg") return "image/jpeg";
  if (type && type !== "application/octet-stream") return type;
  if (extension === ".jpg" || extension === ".jpeg" || extension === ".jpe" || extension === ".jfif" || extension === ".ipg") {
    return "image/jpeg";
  }
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return type || "application/octet-stream";
}

function extensionFromType(type: string) {
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  return ".png";
}

async function uploadReferenceImages(files: FormDataEntryValue[], category: string) {
  const uploadDir = path.join(process.cwd(), "public", "uploads", category);
  await mkdir(uploadDir, { recursive: true });

  const uploaded = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const item of files) {
    if (!(item instanceof File)) continue;
    const normalizedType = normalizeImageType(item.name || "", item.type || "");
    const extension = path.extname((item.name || "").toLowerCase());

    if (!ALLOWED_REFERENCE_TYPES.has(normalizedType) && !ALLOWED_REFERENCE_EXTENSIONS.has(extension)) {
      rejected.push({ name: item.name || "unknown", reason: "仅支持 JPG/JPEG、PNG、WebP 图片。" });
      continue;
    }

    if (item.size > MAX_REFERENCE_FILE_SIZE) {
      rejected.push({ name: item.name || "unknown", reason: "单张图片不能超过 10MB。" });
      continue;
    }

    const sourceBuffer = Buffer.from(await item.arrayBuffer());
    let prepared;

    try {
      prepared = await prepareImageBuffer(sourceBuffer, {
        maxEdge: 4096,
        quality: 92,
        format: normalizedType === "image/webp" ? "webp" : normalizedType === "image/jpeg" ? "jpeg" : "png",
      });
    } catch {
      rejected.push({ name: item.name || "unknown", reason: "图片文件无效或已损坏。" });
      continue;
    }

    const fileName = `${Date.now()}-${nanoid(8)}${extensionFromType(normalizedType)}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, prepared.buffer);

    uploaded.push({
      url: `/api/uploads/${category}/${fileName}`,
      name: item.name,
      type: normalizedType,
      size: prepared.buffer.length,
      category,
    });
  }

  return { uploaded, rejected };
}

async function uploadAttachments(params: {
  files: FormDataEntryValue[];
  accessCodeId: string;
  conversationId?: string | null;
  messageId?: string | null;
}) {
  const uploaded = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  const conversation = params.conversationId
    ? await prisma.savedConversation.findFirst({
        where: {
          id: params.conversationId,
          accessCodeId: params.accessCodeId,
        },
        select: { id: true },
      })
    : null;
  const conversationId = conversation?.id || null;

  for (const item of params.files) {
    if (!(item instanceof File)) continue;

    try {
      const parsed = await parseAndStoreAttachment(item);
      const record = await prisma.attachment.create({
        data: {
          accessCodeId: params.accessCodeId,
          conversationId,
          messageId: params.messageId || null,
          name: parsed.name,
          mimeType: parsed.mimeType,
          size: parsed.size,
          kind: parsed.kind,
          status: "READY",
          url: parsed.url,
          storagePath: parsed.storagePath,
          summary: parsed.summary,
          materials: parsed.materials,
          warnings: parsed.warnings,
        },
      });

      uploaded.push({
        id: record.id,
        url: parsed.url,
        name: parsed.name,
        type: parsed.mimeType,
        mimeType: parsed.mimeType,
        size: parsed.size,
        kind: parsed.kind,
        status: record.status,
        summary: parsed.summary,
        materials: parsed.materials,
        warnings: parsed.warnings,
      });
    } catch (error) {
      rejected.push({
        name: item.name || "unknown",
        reason: error instanceof Error ? error.message : "附件解析失败。",
      });
    }
  }

  return { uploaded, rejected };
}

export async function POST(request: NextRequest) {
  try {
    assertWritableRequest(request);
    const session = await requireAccessSession(request);

    const formData = await request.formData();
    const files = formData.getAll("files");
    const mode = String(formData.get("mode") || "");
    const categoryValue = String(formData.get("category") || "other");
    const category = ALLOWED_CATEGORIES.has(categoryValue) ? categoryValue : "other";

    if (mode === "attachments") {
      const { uploaded, rejected } = await uploadAttachments({
        files,
        accessCodeId: session.id,
        conversationId: String(formData.get("conversationId") || "") || null,
        messageId: String(formData.get("messageId") || "") || null,
      });

      return NextResponse.json({
        ok: uploaded.length > 0,
        files: uploaded,
        attachments: uploaded,
        rejected,
        message: uploaded.length > 0 ? undefined : rejected[0]?.reason || "没有可上传的附件。",
      });
    }

    const { uploaded, rejected } = await uploadReferenceImages(files, category);

    return NextResponse.json({
      ok: uploaded.length > 0,
      files: uploaded,
      rejected,
      message: uploaded.length > 0 ? undefined : rejected[0]?.reason || "没有可上传的图片。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    const status = message.includes("无权") || message.includes("跨站") || message.includes("口令") ? 403 : 400;

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status },
    );
  }
}
