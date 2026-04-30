import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function getContentType(filename: string) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await context.params;

    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_FILENAME",
        },
        { status: 400 },
      );
    }

    const filePath = path.join(process.cwd(), "data", "generated", filename);
    const fileBuffer = await readFile(filePath);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": getContentType(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "IMAGE_NOT_FOUND",
      },
      { status: 404 },
    );
  }
}