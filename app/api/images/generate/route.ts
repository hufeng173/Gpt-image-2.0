import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateImageByRelay } from "@/lib/ai/relay-provider";

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

    const images = await generateImageByRelay({
      prompt: input.negative
        ? `${input.prompt}\n\nNegative prompt: ${input.negative}`
        : input.prompt,
      size: input.size,
      count: input.count,
    });

    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        rawResponse: images as object,
        finishedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      images,
    });
  } catch (error) {
    console.error(error);

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

    return NextResponse.json(
      {
        ok: false,
        error: "IMAGE_GENERATION_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}