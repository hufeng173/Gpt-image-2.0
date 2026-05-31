import { NextRequest, NextResponse } from "next/server";
import { access } from "node:fs/promises";
import { requireAccessSession } from "@/lib/access-control";
import { localImageUrlToFilePath } from "@/lib/image-files";
import { prisma } from "@/lib/prisma";

async function imageFileExists(url: string) {
  try {
    await access(localImageUrlToFilePath(url));
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAccessSession(request);
    const images = await prisma.image.findMany({
      where: session.role === "ADMIN"
        ? {
            OR: [
              { accessCodeId: session.id },
              { accessCode: { role: "USER" } },
            ],
          }
        : { accessCodeId: session.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        accessCode: { select: { label: true, role: true } },
        job: { select: { prompt: true, model: true, size: true } },
      },
    });

    const existingImages = (await Promise.all(
      images.map(async (image) => ((await imageFileExists(image.url)) ? image : null)),
    )).filter((image) => image !== null);

    return NextResponse.json({
      ok: true,
      images: existingImages.map((image) => ({
        id: image.id,
        ownerAccessCodeId: image.accessCodeId,
        url: image.url,
        width: image.width,
        height: image.height,
        seed: image.seed,
        createdAt: image.createdAt.toISOString(),
        ownerLabel: image.accessCode?.label || "未归属",
        ownerRole: image.accessCode?.role || null,
        prompt: image.job.prompt,
        model: image.job.model,
        size: image.job.size,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取图片失败。";
    return NextResponse.json({ ok: false, message }, { status: 401 });
  }
}
