import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { prisma } from "@/lib/prisma";
import { generateImageByRelay, editImageByRelay, type RelayImageItem } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";

export const runtime = "nodejs";

const SupportedModelSizes = ["1024x1024", "1024x1536", "1536x1024"] as const;

const OptionalPositiveInt = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }

    const numberValue = Number(value);

    if (Number.isNaN(numberValue)) {
      return undefined;
    }

    return numberValue;
  },
  z.number().int().positive().max(8192).optional(),
);

const GenerateImageSchema = z.object({
  prompt: z.string().min(2).max(4000),
  negative: z.string().optional().default(""),
  model: z.string().optional(),
  size: z.string().default("1024x1024"),
  sizeMode: z.enum(["preset", "custom"]).optional().default("preset"),
  customWidth: OptionalPositiveInt,
  customHeight: OptionalPositiveInt,
  count: z.number().int().min(1).max(12).default(1),
  selectedImageUrl: z.string().optional(),
  referenceImageUrls: z.array(z.string()).max(8).optional().default([]),
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});

type GeneratedImageResult = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
};

function parseSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);

  if (!match) {
    return {
      width: 1024,
      height: 1024,
    };
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function chooseBestModelSize(width: number, height: number): (typeof SupportedModelSizes)[number] {
  const ratio = width / height;

  if (ratio > 1.2) {
    return "1536x1024";
  }

  if (ratio < 0.82) {
    return "1024x1536";
  }

  return "1024x1024";
}

function resolveSize(input: z.infer<typeof GenerateImageSchema>) {
  if (input.sizeMode === "custom") {
    if (!input.customWidth || !input.customHeight) {
      throw new Error("请输入有效的自定义宽度和高度。");
    }

    const targetWidth = input.customWidth;
    const targetHeight = input.customHeight;

    return {
      modelSize: chooseBestModelSize(targetWidth, targetHeight),
      targetWidth,
      targetHeight,
      finalSizeText: `${targetWidth}x${targetHeight}`,
      isCustomSize: true,
    };
  }

  const presetSize = SupportedModelSizes.includes(input.size as (typeof SupportedModelSizes)[number])
    ? (input.size as (typeof SupportedModelSizes)[number])
    : "1024x1024";

  const parsed = parseSize(presetSize);

  return {
    modelSize: presetSize,
    targetWidth: parsed.width,
    targetHeight: parsed.height,
    finalSizeText: presetSize,
    isCustomSize: false,
  };
}

function buildPrompt(input: z.infer<typeof GenerateImageSchema>, finalSizeText: string) {
  const parts = [input.prompt.trim()];

  if (input.negative?.trim()) {
    parts.push(`Negative prompt: ${input.negative.trim()}`);
  }

  if (input.conversation.length > 0) {
    const recentConversation = input.conversation
      .slice(-6)
      .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
      .join("\n");

    parts.push(`上下文参考：\n${recentConversation}`);
  }

  if (input.selectedImageUrl) {
    parts.push("请参考当前选中图片进行单图优化，保留核心主体与构图方向。");
  }

  if (input.referenceImageUrls.length > 0) {
    parts.push("请参考已上传示例图片的主体、风格、构图或色彩关系。");
  }

  parts.push(`最终输出画面比例需要适配 ${finalSizeText}。`);

  return parts.join("\n\n");
}

async function imageUrlToBuffer(imageUrl: string) {
  if (imageUrl.startsWith("/")) {
    const localPath = path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
    return sharp(localPath).png().toBuffer();
  }

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`参考图片读取失败：${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function relayImageToBuffer(item: RelayImageItem) {
  if (item.b64_json) {
    return Buffer.from(item.b64_json, "base64");
  }

  if (item.url) {
    return imageUrlToBuffer(item.url);
  }

  throw new Error("模型没有返回有效图片。");
}

async function saveFinalImage(params: {
  imageBuffer: Buffer;
  jobId: string;
  index: number;
  width: number;
  height: number;
}) {
  const outputDir = path.join(process.cwd(), "public", "generated");
  await mkdir(outputDir, { recursive: true });

  const fileName = `${params.jobId}-${params.index + 1}-${nanoid(8)}.png`;
  const filePath = path.join(outputDir, fileName);
  const publicUrl = `/generated/${fileName}`;

  const finalBuffer = await sharp(params.imageBuffer)
    .resize(params.width, params.height, {
      fit: "cover",
      position: "centre",
    })
    .png()
    .toBuffer();

  await writeFile(filePath, finalBuffer);

  return publicUrl;
}

async function generateImagesWithConcurrency<T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
) {
  const results: T[] = [];
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (nextIndex < count) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(currentIndex);
    }
  });

  await Promise.all(workers);

  return results;
}

export async function POST(request: NextRequest) {
  let jobId: string | null = null;

  try {
    const body = await request.json();
    const input = GenerateImageSchema.parse(body);
    const settings = await getAppSettings();

    const model = input.model || settings.defaultImageModel || process.env.AI_IMAGE_MODEL || "gpt-image-2";
    const resolvedSize = resolveSize(input);
    const mergedPrompt = buildPrompt(input, resolvedSize.finalSizeText);

    const maxConcurrentJobs =
      "maxConcurrentJobs" in settings &&
      typeof settings.maxConcurrentJobs === "number"
        ? settings.maxConcurrentJobs
        : 8;

    const safeConcurrency = Math.max(1, Math.min(maxConcurrentJobs, 12));
    const requestedCount = Math.max(1, Math.min(input.count, 12));

    const job = await prisma.imageJob.create({
      data: {
        model,
        prompt: input.prompt,
        negative: input.negative || null,
        size: resolvedSize.finalSizeText,
        count: requestedCount,
        status: "RUNNING",
      },
    });

    jobId = job.id;

    const savedImages = await generateImagesWithConcurrency(
      requestedCount,
      safeConcurrency,
      async (index): Promise<GeneratedImageResult> => {
        let relayImages: RelayImageItem[];

        if (input.selectedImageUrl) {
          try {
            const selectedImageBuffer = await imageUrlToBuffer(input.selectedImageUrl);

            relayImages = await editImageByRelay({
              model,
              prompt: mergedPrompt,
              imageBuffer: selectedImageBuffer,
              size: resolvedSize.modelSize,
              count: 1,
            });
          } catch {
            relayImages = await generateImageByRelay({
              model,
              prompt: mergedPrompt,
              size: resolvedSize.modelSize,
              count: 1,
            });
          }
        } else {
          relayImages = await generateImageByRelay({
            model,
            prompt: mergedPrompt,
            size: resolvedSize.modelSize,
            count: 1,
          });
        }

        const firstImage = relayImages[0];

        if (!firstImage) {
          throw new Error("模型没有返回图片。");
        }

        const sourceBuffer = await relayImageToBuffer(firstImage);

        const publicUrl = await saveFinalImage({
          imageBuffer: sourceBuffer,
          jobId: job.id,
          index,
          width: resolvedSize.targetWidth,
          height: resolvedSize.targetHeight,
        });

        const imageRecord = await prisma.image.create({
          data: {
            jobId: job.id,
            url: publicUrl,
            width: resolvedSize.targetWidth,
            height: resolvedSize.targetHeight,
          },
        });

        return {
          id: imageRecord.id,
          url: imageRecord.url,
          width: imageRecord.width ?? null,
          height: imageRecord.height ?? null,
          seed: imageRecord.seed ?? null,
        };
      },
    );

    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        rawResponse: {
          model,
          requestedSize: resolvedSize.finalSizeText,
          modelSize: resolvedSize.modelSize,
          targetWidth: resolvedSize.targetWidth,
          targetHeight: resolvedSize.targetHeight,
          isCustomSize: resolvedSize.isCustomSize,
          images: savedImages,
        },
        finishedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      model,
      size: resolvedSize.finalSizeText,
      modelSize: resolvedSize.modelSize,
      isCustomSize: resolvedSize.isCustomSize,
      images: savedImages,
    });
  } catch (error) {
    console.error("IMAGE_GENERATION_ERROR:", error);

    if (jobId) {
      await prisma.imageJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: getErrorMessage(error),
          finishedAt: new Date(),
        },
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "IMAGE_GENERATION_FAILED",
        message: getErrorMessage(error),
        shortReason: getShortErrorReason(error),
        upstreamStatus: getUpstreamStatus(error),
      },
      { status: 502 },
    );
  }
}