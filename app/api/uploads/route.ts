import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function extensionFromType(type: string) {
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  return ".png";
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const files = formData.getAll("files");
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });

  const uploaded = [];

  for (const item of files) {
    if (!(item instanceof File)) continue;
    if (!ALLOWED_TYPES.has(item.type)) continue;
    if (item.size > MAX_FILE_SIZE) continue;

    const buffer = Buffer.from(await item.arrayBuffer());
    const fileName = `${Date.now()}-${nanoid(8)}${extensionFromType(item.type)}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, buffer);

    uploaded.push({
      url: `/uploads/${fileName}`,
      name: item.name,
      type: item.type,
      size: item.size,
    });
  }

  return NextResponse.json({
    ok: true,
    files: uploaded,
  });
}
