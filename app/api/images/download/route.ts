import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { requireAccessSession } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import { localImageUrlToFilePath } from "@/lib/image-files";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAccessSession(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") || "";
    const format = searchParams.get("format") === "jpg" ? "jpg" : "png";

    const image = await prisma.image.findUnique({
      where: { id },
      include: {
        job: { select: { accessCodeId: true } },
      },
    });

    if (!image) {
      return NextResponse.json({ ok: false, message: "图片不存在。" }, { status: 404 });
    }

    const canRead = image.accessCodeId === session.id || image.job.accessCodeId === session.id;
    if (!canRead) {
      return NextResponse.json({ ok: false, message: "无权下载该图片。" }, { status: 403 });
    }

    const source = await readFile(localImageUrlToFilePath(image.url));
    const output = format === "jpg"
      ? await sharp(source).jpeg({ quality: 94, mozjpeg: true }).toBuffer()
      : await sharp(source).png().toBuffer();
    const filename = `${path.parse(image.url.split("/").pop() || image.id).name}.${format}`;

    const body = new Uint8Array(output);

    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "jpg" ? "image/jpeg" : "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载图片失败。";
    const status = message.includes("请先输入正确口令") ? 401 : message.includes("无权") || message.includes("跨站") ? 403 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
