import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { prisma } from "@/lib/prisma";
import { generateImageByRelay, editImageByRelay, type RelayImageItem } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { runWithGenerationLimit } from "@/lib/concurrency";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";

export const runtime = "nodejs";

const SupportedModelSizes = ["1024x1024", "1024x1536", "1536x1024"] as const;
const ReferenceCategorySchema = z.enum(["composition", "color", "material", "lighting", "other"]);

type ReferenceCategory = z.infer<typeof ReferenceCategorySchema>;

const MAX_CUSTOM_IMAGE_SIZE = 10000;

const OptionalPositiveInt = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }

    const numberValue = Number(value);

    if (!Number.isFinite(numberValue) || Number.isNaN(numberValue)) {
      return undefined;
    }

    return numberValue;
  },
  z
    .number()
    .int("尺寸必须是整数")
    .positive("尺寸必须大于 0")
    .max(MAX_CUSTOM_IMAGE_SIZE, `单边尺寸不能超过 ${MAX_CUSTOM_IMAGE_SIZE}`)
    .optional(),
);

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const ReferenceImageSchema = z.object({
  category: ReferenceCategorySchema,
  url: z.string().min(1),
  name: z.string().optional(),
});

const GenerateImageSchema = z.object({
  prompt: z.string().min(2).max(6000),
  negative: z.string().optional().default(""),
  model: z.string().optional(),
  size: z.string().default("1024x1024"),
  sizeMode: z.enum(["preset", "custom"]).optional(),
  useCustomSize: z.boolean().optional(),
  customWidth: OptionalPositiveInt,
  customHeight: OptionalPositiveInt,
  count: z.number().int().min(1).max(12).default(1),
  selectedImageUrl: z.string().optional(),
  referenceImages: z.array(ReferenceImageSchema).max(20).optional().default([]),
  referenceImageUrls: z.array(z.string()).max(20).optional().default([]),
  useReferenceImage: z.boolean().optional().default(true),
  conversation: z.array(ChatMessageSchema).max(40).optional().default([]),
});

type GeneratedImageResult = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  seed: string | null;
};

type GenerationFailure = {
  index: number;
  reason: string;
};

const categoryLabels: Record<ReferenceCategory, string> = {
  composition: "构图",
  color: "配色",
  material: "材质",
  lighting: "光线",
  other: "其他",
};

const categoryInstructions: Record<ReferenceCategory, string> = {
  composition: "构图参考：优先学习画面布局、主体位置、镜头距离、留白比例、透视关系。",
  color: "配色参考：优先学习主色、辅色、明度、饱和度、整体色彩情绪。",
  material: "材质参考：优先学习表面质感、纹理、材料触感、细节颗粒和真实物理感。",
  lighting: "光线参考：优先学习光源方向、明暗关系、阴影、反光、氛围光和层次。",
  other: "其他参考：作为万能参考，可综合学习主体、风格、场景、道具、气质或任何用户想保留的视觉特征。",
};

function parseSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function chooseBestModelSize(width: number, height: number): (typeof SupportedModelSizes)[number] {
  const ratio = width / height;
  if (ratio > 1.2) return "1536x1024";
  if (ratio < 0.82) return "1024x1536";
  return "1024x1024";
}

function resolveSize(input: z.infer<typeof GenerateImageSchema>) {
  const isCustom = input.sizeMode === "custom" || input.useCustomSize === true;

  if (isCustom) {
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

function normalizeReferenceImages(input: z.infer<typeof GenerateImageSchema>) {
  if (!input.useReferenceImage) return [];

  const categorized = input.referenceImages || [];
  const legacy = (input.referenceImageUrls || []).map((url) => ({
    category: "other" as const,
    url,
    name: "legacy-reference",
  }));

  return [...categorized, ...legacy].filter((item) => item.url);
}

function buildReferencePrompt(referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>) {
  if (referenceImages.length === 0) return "";

  const grouped = referenceImages.reduce<Record<ReferenceCategory, Array<{ url: string; name?: string }>>>(
    (acc, item) => {
      acc[item.category].push({ url: item.url, name: item.name });
      return acc;
    },
    {
      composition: [],
      color: [],
      material: [],
      lighting: [],
      other: [],
    },
  );

  const lines = (Object.keys(grouped) as ReferenceCategory[])
    .filter((category) => grouped[category].length > 0)
    .map((category) => {
      const refs = grouped[category]
        .map((item, index) => `${index + 1}. ${item.name || item.url}`)
        .join("；");
      return `${categoryInstructions[category]} 当前${categoryLabels[category]}参考图：${refs}`;
    });

  return lines.join("\n");
}

function buildPrompt(
  input: z.infer<typeof GenerateImageSchema>,
  finalSizeText: string,
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>,
) {
  const parts = [input.prompt.trim()];

  parts.push("质量要求：主体清晰、准确对焦、高清细节、边缘清楚、纹理真实、画面干净、层次分明、避免虚焦、避免雾化、避免低清晰度。不要仅依赖负面提示词，请直接正向保证清晰度与细节表现。");

  if (input.negative?.trim()) {
    parts.push(`Negative prompt: ${input.negative.trim()}`);
  }

  if (input.conversation.length > 0) {
    const recentConversation = input.conversation
      .slice(-10)
      .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
      .join("\n");

    parts.push(`上下文参考：\n${recentConversation}`);
  }

  if (input.selectedImageUrl) {
    parts.push("当前任务是对选中图片进行单图优化：请尽量保留主体、基础构图和核心气质，只根据用户新要求调整画面。单图优化不应默认扩大成多张，除非请求中明确要求多张。");
  }

  const referencePrompt = buildReferencePrompt(referenceImages);
  if (referencePrompt) {
    parts.push(`分类参考图要求：\n${referencePrompt}\n请按分类权重理解参考图：构图只重点影响构图，配色只重点影响色彩，材质只重点影响材质，光线只重点影响光照，其他作为万能补充。`);
  }

  parts.push(`最终输出画面比例需要适配 ${finalSizeText}。如果模型原生尺寸不同，后处理会裁切/缩放到此尺寸，请构图时保留主体安全边距。`);

  return parts.join("\n\n");
}

function buildWarnings(params: {
  targetWidth: number;
  targetHeight: number;
  isCustomSize: boolean;
  hasNegative: boolean;
}) {
  const warnings: string[] = [];

  if (params.isCustomSize && (params.targetWidth < 512 || params.targetHeight < 512)) {
    warnings.push("当前自定义尺寸较小，放大查看时容易显得模糊。若希望更清晰，建议提高尺寸后再生成。");
  }

  if (params.hasNegative) {
    warnings.push("提示：仅写负面提示词通常不足以显著提升清晰度，主提示词里也建议明确加入主体清晰、准确对焦、高清细节等正向描述。");
  }

  return warnings;
}

async function imageUrlToBuffer(imageUrl: string) {
  if (imageUrl.startsWith("/")) {
    const localPath = path.join(process.cwd(), "public", imageUrl.replace(/^\//, ""));
    return sharp(localPath).png().toBuffer();
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`参考图片读取失败：${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function relayImageToBuffer(item: RelayImageItem) {
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url) return imageUrlToBuffer(item.url);
  throw new Error("模型没有返回有效图片。");
}

async function saveFinalImage(params: {
  imageBuffer: Buffer;
  jobId: string;
  index: number;
  width: number;
  height: number;
}) {
  const outputDir = path.join(process.cwd(), "data", "generated");
  await mkdir(outputDir, { recursive: true });

  const fileName = `${params.jobId}-${params.index + 1}-${nanoid(8)}.png`;
  const filePath = path.join(outputDir, fileName);

  const publicUrl = `/api/generated/${fileName}`;

  const finalBuffer = await sharp(params.imageBuffer)
    .resize(params.width, params.height, {
      fit: "cover",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 1.05, m1: 0.8, m2: 2.5 })
    .png()
    .toBuffer();

  await writeFile(filePath, finalBuffer);

  return publicUrl;
}

async function generateOneImage(params: {
  model: string;
  prompt: string;
  selectedImageUrl?: string;
  allowReferenceImageEdit: boolean;
  modelSize: (typeof SupportedModelSizes)[number];
}) {
  if (params.selectedImageUrl && params.allowReferenceImageEdit) {
    try {
      const selectedImageBuffer = await imageUrlToBuffer(params.selectedImageUrl);
      return await editImageByRelay({
        model: params.model,
        prompt: params.prompt,
        imageBuffer: selectedImageBuffer,
        size: params.modelSize,
        count: 1,
      });
    } catch (error) {
      console.warn("IMAGE_EDIT_FALLBACK_TO_GENERATE:", error);
    }
  }

  return generateImageByRelay({
    model: params.model,
    prompt: params.prompt,
    size: params.modelSize,
    count: 1,
  });
}

export async function POST(request: NextRequest) {
  let jobId: string | null = null;

  try {
    const body = await request.json();
    const input = GenerateImageSchema.parse(body);
    const settings = await getAppSettings();

    const model = input.model || settings.defaultImageModel || process.env.AI_IMAGE_MODEL || "gpt-image-2";
    const resolvedSize = resolveSize(input);
    const referenceImages = normalizeReferenceImages(input);
    const mergedPrompt = buildPrompt(input, resolvedSize.finalSizeText, referenceImages);
    const warnings = buildWarnings({
      targetWidth: resolvedSize.targetWidth,
      targetHeight: resolvedSize.targetHeight,
      isCustomSize: resolvedSize.isCustomSize,
      hasNegative: Boolean(input.negative?.trim()),
    });

    const safeConcurrency = Math.max(1, Math.min(settings.maxConcurrentGenerations || 8, 16));
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

    const failures: GenerationFailure[] = [];
    const savedImages: GeneratedImageResult[] = [];

    await Promise.all(
      Array.from({ length: requestedCount }, async (_, index) => {
        try {
          const imageResult = await runWithGenerationLimit(safeConcurrency, async () => {
            const relayImages = await generateOneImage({
              model,
              prompt: mergedPrompt,
              selectedImageUrl: input.selectedImageUrl,
              allowReferenceImageEdit: settings.allowReferenceImageEdit,
              modelSize: resolvedSize.modelSize,
            });

            const firstImage = relayImages[0];
            if (!firstImage) throw new Error("模型没有返回图片。");

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
          });

          savedImages[index] = imageResult;
        } catch (error) {
          failures.push({
            index: index + 1,
            reason: getShortErrorReason(error),
          });
        }
      }),
    );

    const successfulImages = savedImages.filter(Boolean);

    if (successfulImages.length === 0) {
      throw new Error(failures[0]?.reason || "所有图片都生成失败。");
    }

    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: failures.length > 0 ? "FAILED" : "SUCCEEDED",
        errorMessage: failures.length > 0 ? `部分生成失败：${failures.map((item) => `第${item.index}张 ${item.reason}`).join("；")}` : null,
        rawResponse: {
          model,
          requestedSize: resolvedSize.finalSizeText,
          modelSize: resolvedSize.modelSize,
          targetWidth: resolvedSize.targetWidth,
          targetHeight: resolvedSize.targetHeight,
          isCustomSize: resolvedSize.isCustomSize,
          referenceImages,
          selectedImageUrl: input.selectedImageUrl || null,
          images: successfulImages,
          failures,
          warnings,
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
      requestedCount,
      generatedCount: successfulImages.length,
      images: successfulImages,
      failures,
      warnings: [
        ...warnings,
        ...(failures.length > 0 ? ["部分图片生成失败，已保留成功结果。"] : []),
      ],
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
