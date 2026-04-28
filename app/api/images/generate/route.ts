import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { generateImageByRelay, type RelayImageItem } from "@/lib/ai/relay-provider";

export const runtime = "nodejs";

const GenerateImageSchema = z.object({
  prompt: z.string().min(2).max(4000),
  negative: z.string().optional(),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"),
  count: z.number().int().min(1).max(4).default(1),
});

export async function POST(request: NextRequest) {
  let jobId: string | null = null;

  try {
    const body = await request.json();
    const input = GenerateImageSchema.parse(body);

    const mergedPrompt = input.negative?.trim()
      ? `${input.prompt}\n\nNegative prompt: ${input.negative}`
      : input.prompt;

    const job = await prisma.imageJob.create({
      data: {
        model: process.env.AI_IMAGE_MODEL || "unknown",
        prompt: input.prompt,
        negative: input.negative,
        size: input.size,
        count: input.count,
        status: "RUNNING",
      },
    });

    jobId = job.id;

    const relayImages = (await generateImageByRelay({
      prompt: mergedPrompt,
      size: input.size,
      count: input.count,
    })) as RelayImageItem[];

    const outputDir = path.join(process.cwd(), "public", "generated");
    await mkdir(outputDir, { recursive: true });

    const savedImages: Array<{
      id: string;
      url: string;
      width: number | null;
      height: number | null;
      seed: string | null;
    }> = [];

    for (let index = 0; index < relayImages.length; index++) {
      const item = relayImages[index];

      if (item.b64_json) {
        const fileName = `${job.id}-${index + 1}-${nanoid(8)}.png`;
        const filePath = path.join(outputDir, fileName);
        const publicUrl = `/generated/${fileName}`;

        await writeFile(filePath, Buffer.from(item.b64_json, "base64"));

        const imageRecord = await prisma.image.create({
          data: {
            jobId: job.id,
            url: publicUrl,
          },
        });

        savedImages.push({
          id: imageRecord.id,
          url: imageRecord.url,
          width: imageRecord.width ?? null,
          height: imageRecord.height ?? null,
          seed: imageRecord.seed ?? null,
        });
      } else if (item.url) {
        const imageRecord = await prisma.image.create({
          data: {
            jobId: job.id,
            url: item.url,
          },
        });

        savedImages.push({
          id: imageRecord.id,
          url: imageRecord.url,
          width: imageRecord.width ?? null,
          height: imageRecord.height ?? null,
          seed: imageRecord.seed ?? null,
        });
      }
    }

    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        rawResponse: relayImages as object,
        finishedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      images: savedImages,
      rawImages: relayImages,
    });
  } catch (error) {
    console.error("IMAGE_GENERATION_ERROR:", error);

    if (jobId) {
      await prisma.imageJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "unknown error",
          finishedAt: new Date(),
        },
      });
    }

    const upstreamStatus =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status?: number }).status ?? null)
        : null;

    return NextResponse.json(
      {
        ok: false,
        error: "IMAGE_GENERATION_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        upstreamStatus,
      },
      { status: 502 },
    );
  }
}
