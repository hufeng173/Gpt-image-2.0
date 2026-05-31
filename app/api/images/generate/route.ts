import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { prisma } from "@/lib/prisma";
import { generateImageByRelay, editImageByRelay, type RelayImageInputFidelity, type RelayImageItem } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { runWithGenerationLimit } from "@/lib/concurrency";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";
import { assertWritableRequest } from "@/lib/request-guard";
import { readPreparedLocalImage } from "@/lib/image-files";
import { requireAccessSession } from "@/lib/access-control";
import { formatAttachmentsForPrompt } from "@/lib/attachments";

export const runtime = "nodejs";

const SupportedPresetSizes = [
  "1920x1080",
  "2560x1440",
  "3840x2160",
  "1080x1920",
  "1080x1440",
  "1080x1080",
  "1440x1080",
  "800x800",
  "1000x1000",
] as const;
const ReferenceCategorySchema = z.enum(["composition", "color", "material", "lighting", "other"]);
const InputFidelitySchema = z.enum(["high", "low"]);

type SupportedModelSize = "1024x1024" | "1024x1536" | "1536x1024";
type ReferenceCategory = z.infer<typeof ReferenceCategorySchema>;
type ExpiredGeneratedImage = {
  id: string;
  url: string;
};

const MIN_CUSTOM_IMAGE_SIZE = 100;
const MAX_CUSTOM_IMAGE_SIZE = 8192;
const MAX_EDIT_REFERENCE_IMAGES = 16;
const GENERATED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const GENERATED_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastGeneratedCleanup = 0;

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
    .min(MIN_CUSTOM_IMAGE_SIZE, `单边尺寸不能低于 ${MIN_CUSTOM_IMAGE_SIZE}`)
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

const AttachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  summary: z.string().optional(),
  url: z.string().nullable().optional(),
  materials: z.unknown().optional(),
});

const GenerateImageSchema = z.object({
  prompt: z.string().min(2).max(6000),
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
  inputFidelity: InputFidelitySchema.optional().default("high"),
  conversation: z.array(ChatMessageSchema).max(40).optional().default([]),
  attachments: z.array(AttachmentSchema).max(12).optional().default([]),
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

type GenerationNote = {
  index: number;
  message: string;
};

type PreparedReferenceBatch = {
  buffers: Buffer[];
  note: string | null;
};

type GenerationJobPayload = {
  sessionId: string;
  input: z.infer<typeof GenerateImageSchema>;
  model: string;
  resolvedSize: ReturnType<typeof resolveSize>;
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>;
  usesImageEdit: boolean;
  mergedPrompt: string;
  warnings: string[];
  safeConcurrency: number;
  requestedCount: number;
};

type GenerationJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL_SUCCEEDED" | "FAILED";

type GenerationJobResult = {
  jobId: string;
  status: GenerationJobStatus;
  model: string;
  size: string;
  modelSize: SupportedModelSize;
  isCustomSize: boolean;
  requestedCount: number;
  generatedCount: number;
  images: GeneratedImageResult[];
  failures: GenerationFailure[];
  notes: GenerationNote[];
  warnings: string[];
  errorMessage?: string | null;
  createdAt?: string;
  finishedAt?: string | null;
};

const generationTasks = new Map<string, Promise<void>>();

const categoryLabels: Record<ReferenceCategory, string> = {
  composition: "构图",
  color: "配色",
  material: "材质",
  lighting: "光线",
  other: "其他",
};

const categoryInstructions: Record<ReferenceCategory, string> = {
  composition: "构图参考：优先学习画面布局、主体位置、镜头距离、留白比例和透视关系。",
  color: "配色参考：优先学习主色、辅色、明度、饱和度和整体色彩情绪。",
  material: "材质参考：优先学习表面质感、纹理、材料触感、细节颗粒和真实物理感。",
  lighting: "光线参考：优先学习光源方向、明暗关系、阴影、反光、氛围光和层次。",
  other: "其他参考：作为综合参考，学习主体、风格、场景、道具、气质或其他视觉特征。",
};

function parseSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 1024, height: 1024 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function chooseBestModelSize(width: number, height: number): SupportedModelSize {
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

  const presetSize = SupportedPresetSizes.includes(input.size as (typeof SupportedPresetSizes)[number])
    ? input.size
    : "1920x1080";

  const parsed = parseSize(presetSize);

  return {
    modelSize: chooseBestModelSize(parsed.width, parsed.height),
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
  const imageAttachments = (input.attachments || [])
    .filter((item) => item.kind === "IMAGE" && item.url)
    .map((item) => ({
      category: "other" as const,
      url: item.url || "",
      name: item.name || "attachment-image",
    }));

  return [...categorized, ...legacy, ...imageAttachments].filter((item) => item.url);
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
      const refsText = grouped[category]
        .map((item, index) => `${index + 1}. ${item.name || item.url}`)
        .join("；");
      return `${categoryInstructions[category]} 当前${categoryLabels[category]}参考图：${refsText}`;
    });

  return lines.join("\n");
}

function buildPrompt(
  input: z.infer<typeof GenerateImageSchema>,
  finalSizeText: string,
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>,
) {
  const parts = [input.prompt.trim()];

  parts.push("质量要求：主体清晰、准确对焦、高清细节、边缘清楚、纹理真实、画面干净、层次分明，避免虚焦、雾化和低清晰度。请用正向描述保证清晰度与细节表现。");

  if (input.conversation.length > 0) {
    const recentConversation = input.conversation
      .slice(-10)
      .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
      .join("\n");

    parts.push(`上下文参考：\n${recentConversation}`);
  }

  const attachmentPrompt = formatAttachmentsForPrompt(input.attachments);
  if (attachmentPrompt) {
    parts.push(`${attachmentPrompt}\n请把这些附件理解为素材来源。文档和表格提供内容信息，图片附件可作为视觉参考，但不要凭空添加附件中没有的品牌、人物或文字。`);
  }

  if (input.selectedImageUrl) {
    parts.push("当前任务是基于选中图片进行编辑优化。第一张输入图片是主图，必须严格保留主图的主体身份、构图、姿态、主要色彩、背景关系和画面比例，只按照用户新增要求做必要调整。不要替换为无关主体，不要重新发散成另一张图，不要让其他附件或参考图覆盖主图。");
  }

  const referencePrompt = buildReferencePrompt(referenceImages);
  if (referencePrompt) {
    parts.push(`分类参考图要求：\n${referencePrompt}\n请按分类权重理解参考图：构图只重点影响构图，配色只重点影响色彩，材质只重点影响材质，光线只重点影响光照，其他作为综合补充。`);
  }

  parts.push(`最终输出画面比例需要适配 ${finalSizeText}。如果模型原生尺寸不同，后处理会裁切或缩放到此尺寸，请构图时保留主体安全边距。`);

  return parts.join("\n\n");
}

function buildWarnings(params: {
  targetWidth: number;
  targetHeight: number;
  isCustomSize: boolean;
  referenceImageCount: number;
  usesImageEdit: boolean;
  inputFidelity: RelayImageInputFidelity;
}) {
  const warnings: string[] = [];

  if (params.isCustomSize && (params.targetWidth < 512 || params.targetHeight < 512)) {
    warnings.push("当前自定义尺寸较小，放大查看时容易显得模糊。若希望更清晰，建议提高尺寸后再生成。");
  }

  if (params.referenceImageCount > MAX_EDIT_REFERENCE_IMAGES) {
    warnings.push(`参考图最多传入前 ${MAX_EDIT_REFERENCE_IMAGES} 张给模型，其余只作为文字提示。`);
  }

  if (params.referenceImageCount > 0 && !params.usesImageEdit) {
    warnings.push("当前模型或设置未启用图片编辑接口，参考图只会作为提示词文本辅助。建议使用支持多图编辑的图片模型。");
  }

  if (params.usesImageEdit && params.inputFidelity === "high") {
    warnings.push("当前使用高保真参考图模式，主体保留更强，但通常会比快速模式更慢。");
  }

  return warnings;
}

function canUseImageEdit(params: {
  selectedImageUrl?: string;
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>;
  allowReferenceImageEdit: boolean;
}) {
  return params.allowReferenceImageEdit && (Boolean(params.selectedImageUrl) || params.referenceImages.length > 0);
}

async function imageUrlToBuffer(imageUrl: string) {
  if (imageUrl.startsWith("/")) {
    const image = await readPreparedLocalImage(imageUrl, { maxEdge: 1536, quality: 90, format: "png" });
    return image.buffer;
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

async function readEditReferenceBuffers(params: {
  selectedImageUrl?: string;
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>;
}) {
  const urls = [
    ...(params.selectedImageUrl ? [params.selectedImageUrl] : []),
    ...params.referenceImages.map((item) => item.url),
  ];

  const uniqueUrls = Array.from(new Set(urls)).slice(0, MAX_EDIT_REFERENCE_IMAGES);
  return Promise.all(uniqueUrls.map((url) => imageUrlToBuffer(url)));
}

async function prepareReferenceBatch(params: {
  selectedImageUrl?: string;
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>;
}) : Promise<PreparedReferenceBatch> {
  const urls = [
    ...(params.selectedImageUrl ? [params.selectedImageUrl] : []),
    ...params.referenceImages.map((item) => item.url),
  ];

  const uniqueUrls = Array.from(new Set(urls)).slice(0, MAX_EDIT_REFERENCE_IMAGES);
  if (uniqueUrls.length === 0) {
    return { buffers: [], note: null };
  }

  const buffers = await Promise.all(uniqueUrls.map((url) => imageUrlToBuffer(url)));
  return {
    buffers,
    note: uniqueUrls.length > 1 ? `已复用 ${uniqueUrls.length} 张参考图缓存用于后续批量生成。` : null,
  };
}

async function cleanupGeneratedImages() {
  const now = Date.now();
  if (now - lastGeneratedCleanup < GENERATED_CLEANUP_INTERVAL_MS) return;
  lastGeneratedCleanup = now;

  try {
    const expiredImages = await prisma.image.findMany({
      where: {
        createdAt: {
          lt: new Date(now - GENERATED_RETENTION_MS),
        },
      },
      select: {
        id: true,
        url: true,
      },
      take: 200,
    });

    await Promise.all(expiredImages.map(async (image: ExpiredGeneratedImage) => {
      try {
        if (image.url.startsWith("/api/generated/")) {
          const filename = image.url.split("/").pop()?.split("?")[0];
          if (filename && !filename.includes("..") && !filename.includes("/") && !filename.includes("\\")) {
            await import("node:fs/promises").then(({ unlink }) =>
              unlink(path.join(process.cwd(), "data", "generated", filename)).catch(() => undefined),
            );
          }
        }
      } finally {
        await prisma.image.delete({ where: { id: image.id } }).catch(() => undefined);
      }
    }));
  } catch {
    // Cleanup is best effort and must not block generation.
  }
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
  referenceImages: Array<{ category: ReferenceCategory; url: string; name?: string }>; 
  allowReferenceImageEdit: boolean;
  modelSize: SupportedModelSize;
  inputFidelity: RelayImageInputFidelity;
  preparedReferences?: Buffer[];
}): Promise<{ images: RelayImageItem[]; fallbackWarning: string | null }> {
  if (canUseImageEdit(params)) {
    const referenceBuffers = params.preparedReferences || await readEditReferenceBuffers({
      selectedImageUrl: params.selectedImageUrl,
      referenceImages: params.referenceImages,
    });
    const editPrompt = params.selectedImageUrl
      ? `请以第一张输入图片作为唯一主图进行编辑。保持原图主体、构图、姿态、色彩和背景关系，不要换成无关画面。用户需求如下：\n${params.prompt}`
      : params.prompt;
    const editInput = {
      model: params.model,
      prompt: editPrompt,
      imageBuffers: referenceBuffers,
      size: params.modelSize,
      count: 1,
      inputFidelity: params.inputFidelity,
    };

    try {
      return {
        images: await editImageByRelay(editInput),
        fallbackWarning: null,
      };
    } catch (error) {
      if (getShortErrorReason(error).includes("超时")) {
        try {
          return {
            images: await editImageByRelay(editInput),
            fallbackWarning: "图片编辑接口首次超时，已自动重试并完成。",
          };
        } catch (retryError) {
          console.warn("IMAGE_EDIT_RETRY_FAILED:", retryError);
          if (params.selectedImageUrl) {
            throw new Error(`图片编辑接口重试后仍失败：${getShortErrorReason(retryError)}`);
          }
          error = retryError;
        }
      }

      console.warn("IMAGE_EDIT_FALLBACK_TO_GENERATE:", error);
      if (params.selectedImageUrl) {
        throw new Error(`图片编辑接口失败：${getShortErrorReason(error)}`);
      }
      const fallbackImages = await generateImageByRelay({
        model: params.model,
        prompt: params.prompt,
        size: params.modelSize,
        count: 1,
      });

      return {
        images: fallbackImages,
        fallbackWarning: `图片编辑接口失败，已自动改用纯文本生成。原因：${getShortErrorReason(error)}`,
      };
    }
  }

  return {
    images: await generateImageByRelay({
      model: params.model,
      prompt: params.prompt,
      size: params.modelSize,
      count: 1,
    }),
    fallbackWarning: null,
  };
}

function responseWarnings(params: {
  warnings: string[];
  notes: GenerationNote[];
  failures: GenerationFailure[];
}) {
  return [
    ...params.warnings,
    ...params.notes
      .filter((item) => !item.message.includes("开始生成"))
      .map((item) => `第${item.index}张：${item.message}`),
    ...(params.failures.length > 0 ? ["部分图片生成失败，已保留成功结果。"] : []),
  ];
}

async function runGenerationJob(jobId: string, payload: GenerationJobPayload) {
  try {
    await prisma.imageJob.update({
      where: { id: jobId },
      data: { status: "RUNNING" },
    });

    const failures: GenerationFailure[] = [];
    const notes: GenerationNote[] = [];
    const savedImages: GeneratedImageResult[] = [];
    const preparedReferences = payload.usesImageEdit
      ? (await prepareReferenceBatch({
          selectedImageUrl: payload.input.selectedImageUrl,
          referenceImages: payload.referenceImages,
        })).buffers
      : [];

    await Promise.all(
      Array.from({ length: payload.requestedCount }, async (_, index) => {
        try {
          const queuedResult = await runWithGenerationLimit(payload.safeConcurrency, async () => {
            const generation = await generateOneImage({
              model: payload.model,
              prompt: payload.mergedPrompt,
              selectedImageUrl: payload.input.selectedImageUrl,
              referenceImages: payload.referenceImages,
              allowReferenceImageEdit: payload.usesImageEdit,
              modelSize: payload.resolvedSize.modelSize,
              inputFidelity: payload.input.inputFidelity,
              preparedReferences,
            });

            if (generation.fallbackWarning) {
              notes.push({ index: index + 1, message: generation.fallbackWarning });
            }

            const firstImage = generation.images[0];
            if (!firstImage) throw new Error("模型没有返回图片。");

            const sourceBuffer = await relayImageToBuffer(firstImage);
            const publicUrl = await saveFinalImage({
              imageBuffer: sourceBuffer,
              jobId,
              index,
              width: payload.resolvedSize.targetWidth,
              height: payload.resolvedSize.targetHeight,
            });

            const imageRecord = await prisma.image.create({
              data: {
                jobId,
                accessCodeId: payload.sessionId,
                url: publicUrl,
                width: payload.resolvedSize.targetWidth,
                height: payload.resolvedSize.targetHeight,
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

          savedImages[index] = queuedResult.result;

          if (queuedResult.queued) {
            notes.push({
              index: index + 1,
              message: `已进入队列，前面还有 ${queuedResult.waitingAhead} 个任务。预计等待 ${Math.max(1, Math.round(queuedResult.waitMs / 1000))} 秒后执行。`,
            });
          }
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
      where: { id: jobId },
      data: {
        status: failures.length > 0 ? "PARTIAL_SUCCEEDED" : "SUCCEEDED",
        errorMessage: failures.length > 0 ? `部分生成失败：${failures.map((item) => `第${item.index}张：${item.reason}`).join("；")}` : null,
        rawResponse: {
          model: payload.model,
          requestedSize: payload.resolvedSize.finalSizeText,
          modelSize: payload.resolvedSize.modelSize,
          targetWidth: payload.resolvedSize.targetWidth,
          targetHeight: payload.resolvedSize.targetHeight,
          isCustomSize: payload.resolvedSize.isCustomSize,
          referenceImages: payload.referenceImages,
          selectedImageUrl: payload.input.selectedImageUrl || null,
          inputFidelity: payload.input.inputFidelity,
          images: successfulImages,
          failures,
          notes,
          warnings: payload.warnings,
        },
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("IMAGE_GENERATION_ERROR:", error);
    await prisma.imageJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: getErrorMessage(error),
        finishedAt: new Date(),
      },
    }).catch(() => undefined);
  } finally {
    generationTasks.delete(jobId);
  }
}

function startGenerationJob(jobId: string, payload: GenerationJobPayload) {
  if (generationTasks.has(jobId)) return;
  const task = runGenerationJob(jobId, payload);
  generationTasks.set(jobId, task);
  task.catch((error) => {
    console.error("IMAGE_GENERATION_TASK_ERROR:", error);
    generationTasks.delete(jobId);
  });
}

function buildJobResult(job: {
  id: string;
  model: string;
  size: string;
  count: number;
  status: string;
  errorMessage: string | null;
  rawResponse: unknown;
  createdAt: Date;
  finishedAt: Date | null;
  images: Array<{ id: string; url: string; width: number | null; height: number | null; seed: string | null }>;
}): GenerationJobResult {
  const raw = (job.rawResponse && typeof job.rawResponse === "object" ? job.rawResponse : {}) as {
    modelSize?: SupportedModelSize;
    isCustomSize?: boolean;
    images?: GeneratedImageResult[];
    failures?: GenerationFailure[];
    notes?: GenerationNote[];
    warnings?: string[];
  };
  const images = Array.isArray(raw.images) && raw.images.length
    ? raw.images
    : job.images.map((image) => ({
        id: image.id,
        url: image.url,
        width: image.width,
        height: image.height,
        seed: image.seed,
      }));
  const failures = Array.isArray(raw.failures) ? raw.failures : [];
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  const warnings = Array.isArray(raw.warnings) ? raw.warnings : [];
  const parsedSize = parseSize(job.size);

  return {
    jobId: job.id,
    status: job.status as GenerationJobStatus,
    model: job.model,
    size: job.size,
    modelSize: raw.modelSize || chooseBestModelSize(parsedSize.width, parsedSize.height),
    isCustomSize: Boolean(raw.isCustomSize),
    requestedCount: job.count,
    generatedCount: images.length,
    images,
    failures,
    notes,
    warnings: responseWarnings({ warnings, notes, failures }),
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() || null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAccessSession(request);
    const jobId = request.nextUrl.searchParams.get("jobId");
    if (!jobId) throw new Error("缺少 jobId。");

    const job = await prisma.imageJob.findFirst({
      where: session.role === "ADMIN"
        ? { id: jobId }
        : { id: jobId, accessCodeId: session.id },
      include: {
        images: {
          select: {
            id: true,
            url: true,
            width: true,
            height: true,
            seed: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!job) throw new Error("任务不存在或无权查看。");

    return NextResponse.json({
      ok: true,
      ...buildJobResult(job),
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes("请先输入正确口令") ? 401 : message.includes("无权") ? 403 : 404;
    return NextResponse.json({ ok: false, message, shortReason: getShortErrorReason(error) }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertWritableRequest(request);
    const session = await requireAccessSession(request);
    const body = await request.json();
    const input = GenerateImageSchema.parse(body);
    const settings = await getAppSettings();

    const model = input.model || settings.defaultImageModel || process.env.AI_IMAGE_MODEL || "gpt-image-2";
    const resolvedSize = resolveSize(input);
    const referenceImages = normalizeReferenceImages(input);
    const usesImageEdit = canUseImageEdit({
      selectedImageUrl: input.selectedImageUrl,
      referenceImages,
      allowReferenceImageEdit: settings.allowReferenceImageEdit,
    });
    const mergedPrompt = buildPrompt(input, resolvedSize.finalSizeText, referenceImages);
    const warnings = buildWarnings({
      targetWidth: resolvedSize.targetWidth,
      targetHeight: resolvedSize.targetHeight,
      isCustomSize: resolvedSize.isCustomSize,
      referenceImageCount: referenceImages.length,
      usesImageEdit,
      inputFidelity: input.inputFidelity,
    });

    void cleanupGeneratedImages();

    const safeConcurrency = Math.max(1, Math.min(settings.maxConcurrentGenerations || 8, 20));
    const requestedCount = Math.max(1, Math.min(input.count, 12));

    const job = await prisma.imageJob.create({
      data: {
        accessCodeId: session.id,
        model,
        prompt: input.prompt,
        size: resolvedSize.finalSizeText,
        count: requestedCount,
        status: "PENDING",
        rawResponse: {
          model,
          requestedSize: resolvedSize.finalSizeText,
          modelSize: resolvedSize.modelSize,
          targetWidth: resolvedSize.targetWidth,
          targetHeight: resolvedSize.targetHeight,
          isCustomSize: resolvedSize.isCustomSize,
          referenceImages,
          selectedImageUrl: input.selectedImageUrl || null,
          inputFidelity: input.inputFidelity,
          images: [],
          failures: [],
          notes: [{ index: 0, message: "任务已提交，正在后台生成。" }],
          warnings,
        },
      },
    });

    startGenerationJob(job.id, {
      sessionId: session.id,
      input,
      model,
      resolvedSize,
      referenceImages,
      usesImageEdit,
      mergedPrompt,
      warnings,
      safeConcurrency,
      requestedCount,
    });

    return NextResponse.json({
      ok: true,
      accepted: true,
      jobId: job.id,
      status: "PENDING",
      model,
      size: resolvedSize.finalSizeText,
      modelSize: resolvedSize.modelSize,
      isCustomSize: resolvedSize.isCustomSize,
      requestedCount,
      generatedCount: 0,
      images: [],
      failures: [],
      notes: [{ index: 0, message: "任务已提交，正在后台生成。" }],
      warnings,
    }, { status: 202 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes("请先输入正确口令") ? 401 : message.includes("无权") || message.includes("跨站") ? 403 : 502;

    if (status >= 500) {
      console.error("IMAGE_GENERATION_ERROR:", error);
    }

    return NextResponse.json(
      {
        ok: false,
        error: "IMAGE_GENERATION_FAILED",
        message,
        shortReason: getShortErrorReason(error),
        upstreamStatus: getUpstreamStatus(error),
      },
      { status },
    );
  }
}
