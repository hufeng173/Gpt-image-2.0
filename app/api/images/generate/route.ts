import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { runWithGenerationLimit } from "@/lib/concurrency";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";
import { readPublicImage, saveBase64Image } from "@/lib/image-files";
import { editImageByRelay, generateImageByRelay, type ImageSize, type RelayImageItem } from "@/lib/ai/relay-provider";

export const runtime = "nodejs";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const GenerateImageSchema = z.object({
  prompt: z.string().min(2).max(6000),
  negative: z.string().optional().default(""),
  size: z.string().default("1024x1024"),
  customWidth: z.number().int().min(256).max(2048).optional(),
  customHeight: z.number().int().min(256).max(2048).optional(),
  useCustomSize: z.boolean().optional().default(false),
  count: z.number().int().min(1).max(4).default(1),
  model: z.string().min(1).optional(),
  selectedImageUrl: z.string().optional(),
  referenceImageUrls: z.array(z.string()).max(8).optional(),
  useReferenceImage: z.boolean().optional().default(true),
  conversation: z.array(ChatMessageSchema).max(20).optional(),
});

type SavedImage = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
};

function resolveSize(input: z.infer<typeof GenerateImageSchema>): ImageSize {
  if (input.useCustomSize && input.customWidth && input.customHeight) {
    return `${input.customWidth}x${input.customHeight}` as ImageSize;
  }

  return input.size as ImageSize;
}

function buildPrompt(input: z.infer<typeof GenerateImageSchema>) {
  const conversation = (input.conversation || [])
    .slice(-8)
    .map((item) => `${item.role === "user" ? "用户" : "太极图"}：${item.content}`)
    .join("\n");

  const references = [input.selectedImageUrl, ...(input.referenceImageUrls || [])]
    .filter(Boolean)
    .map((url, index) => `参考图${index + 1}：${url}`)
    .join("\n");

  return [
    input.prompt,
    input.negative?.trim() ? `\nNegative prompt: ${input.negative}` : "",
    conversation ? `\n上下文要求：\n${conversation}` : "",
    references ? `\n参考图说明：已上传参考图，请尽量延续参考图的主体、构图、风格或局部细节。\n${references}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function saveRelayImages(jobId: string, relayImages: RelayImageItem[], offset: number): Promise<SavedImage[]> {
  const saved: SavedImage[] = [];

  for (let index = 0; index < relayImages.length; index++) {
    const item = relayImages[index];
    let imageUrl = item.url || "";

    if (item.b64_json) {
      const stored = await saveBase64Image(item.b64_json, jobId, offset + index);
      imageUrl = stored.url;
    }

    if (!imageUrl) continue;

    const imageRecord = await prisma.image.create({
      data: {
        jobId,
        url: imageUrl,
      },
    });

    saved.push({
      id: imageRecord.id,
      url: imageRecord.url,
      width: imageRecord.width ?? null,
      height: imageRecord.height ?? null,
      seed: imageRecord.seed ?? null,
    });
  }

  return saved;
}

export async function POST(request: NextRequest) {
  let jobId: string | null = null;

  try {
    const body = await request.json();
    const input = GenerateImageSchema.parse(body);
    const settings = await getAppSettings();
    const model = input.model || settings.defaultImageModel || process.env.AI_IMAGE_MODEL || "gpt-image-2";
    const size = resolveSize(input);
    const finalPrompt = buildPrompt(input);
    const referenceUrls = [input.selectedImageUrl, ...(input.referenceImageUrls || [])].filter(Boolean) as string[];

    const job = await prisma.imageJob.create({
      data: {
        model,
        prompt: input.prompt,
        negative: input.negative,
        size,
        count: input.count,
        status: "RUNNING",
      },
    });

    jobId = job.id;

    const warnings: string[] = [];
    const rawResponses: Array<{ index: number; data: RelayImageItem[] }> = [];
    const failures: Array<{ index: number; reason: string }> = [];

    const tasks = Array.from({ length: input.count }, (_, index) =>
      runWithGenerationLimit(settings.maxConcurrentGenerations, async () => {
        try {
          let relayImages: RelayImageItem[] = [];

          if (input.useReferenceImage && settings.allowReferenceImageEdit && referenceUrls[0]) {
            try {
              const referenceImage = await readPublicImage(referenceUrls[0]);
              relayImages = await editImageByRelay({
                model,
                prompt: finalPrompt,
                size,
                referenceImage,
              });
            } catch (editError) {
              warnings.push(`第 ${index + 1} 张参考图编辑失败，已自动切换为文字生成：${getShortErrorReason(editError)}`);
              relayImages = await generateImageByRelay({ model, prompt: finalPrompt, size });
            }
          } else {
            relayImages = await generateImageByRelay({ model, prompt: finalPrompt, size });
          }

          rawResponses.push({ index, data: relayImages });
          return await saveRelayImages(job.id, relayImages, index);
        } catch (error) {
          failures.push({ index, reason: getShortErrorReason(error) });
          return [];
        }
      }),
    );

    const results = await Promise.all(tasks);
    const images = results.flat();

    if (images.length === 0) {
      const reason = failures[0]?.reason || "没有生成成功的图片。";
      await prisma.imageJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMessage: reason,
          rawResponse: { warnings, failures, referenceUrls, size, model },
          finishedAt: new Date(),
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: "IMAGE_GENERATION_FAILED",
          shortReason: reason,
          message: reason,
          warnings,
          failures,
        },
        { status: 502 },
      );
    }

    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: failures.length > 0 ? "SUCCEEDED" : "SUCCEEDED",
        rawResponse: {
          rawResponses: rawResponses.map((item) => ({ index: item.index, count: item.data.length })),
          warnings,
          failures,
          referenceUrls,
          size,
          model,
        },
        finishedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      model,
      size,
      requestedCount: input.count,
      generatedCount: images.length,
      images,
      warnings,
      failures,
    });
  } catch (error) {
    const shortReason = getShortErrorReason(error);
    console.error("IMAGE_GENERATION_ERROR:", error);

    if (jobId) {
      await prisma.imageJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: shortReason,
          finishedAt: new Date(),
        },
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "IMAGE_GENERATION_FAILED",
        message: getErrorMessage(error),
        shortReason,
        upstreamStatus: getUpstreamStatus(error),
      },
      { status: 502 },
    );
  }
}
