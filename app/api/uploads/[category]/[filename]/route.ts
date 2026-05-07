import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const ALLOWED_CATEGORIES = new Set(["composition", "color", "material", "lighting", "other"]);

function getContentType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<any> },
) {
  try {
    const { category, filename } = await context.params;

    if (!ALLOWED_CATEGORIES.has(category) || !filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json({ ok: false, error: "INVALID_IMAGE_PATH" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", category, filename);
    const fileBuffer = await readFile(filePath);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": getContentType(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "IMAGE_NOT_FOUND" }, { status: 404 });
  }
}
