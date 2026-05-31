import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { optimizePromptByRelay } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";
import { localImageUrlToDataUrl } from "@/lib/image-files";
import { requireAccessSession } from "@/lib/access-control";
import { formatAttachmentsForPrompt } from "@/lib/attachments";

const MAX_VISION_OPTIMIZE_REFERENCES = 8;

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const ReferenceImageSchema = z.object({
  category: z.enum(["composition", "color", "material", "lighting", "other"]),
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

const OptimizeSchema = z.object({
  prompt: z.string().max(6000).optional().default(""),
  userMessage: z.string().optional(),
  selectedImageUrl: z.string().optional(),
  referenceImageUrls: z.array(z.string()).max(20).optional(),
  referenceImages: z.array(ReferenceImageSchema).max(20).optional(),
  conversation: z.array(ChatMessageSchema).max(40).optional(),
  attachments: z.array(AttachmentSchema).max(12).optional().default([]),
  model: z.string().optional(),
});

function fallbackOptimize(input: z.infer<typeof OptimizeSchema>) {
  const basePrompt = input.prompt.trim() || input.userMessage?.trim() || "请生成一段高质量 AI 作图提示词";
  const extras = [
    "画面主体明确",
    "构图稳定",
    "层次清晰",
    "细腻光影",
    "材质真实",
    "高级商业视觉",
    "东方美学留白",
  ].join("，");

  const categoryNotes = input.referenceImages?.length
    ? input.referenceImages
        .map((item) => {
          const labelMap = {
            composition: "构图",
            color: "配色",
            material: "材质",
            lighting: "光线",
            other: "其他",
          } as const;
          return `参考${labelMap[item.category]}图`;
        })
        .join("，")
    : "";

  const selectedNote = input.selectedImageUrl ? "，保留选中图片的主体和核心构图并按新要求优化" : "";
  const referenceNote = categoryNotes ? `，重点参考：${categoryNotes}` : "";

  return `${basePrompt}，${extras}${selectedNote}${referenceNote}`;
}

export async function POST(request: NextRequest) {
  try {
    await requireAccessSession(request);
    const body = await request.json();
    const input = OptimizeSchema.parse(body);
    const settings = await getAppSettings();
    const selectedImageUrl = input.selectedImageUrl?.startsWith("/")
      ? await localImageUrlToDataUrl(input.selectedImageUrl, { maxEdge: 1024, quality: 82, format: "jpeg" })
      : input.selectedImageUrl;
    const referenceImages = await Promise.all(
      (input.referenceImages || []).slice(0, MAX_VISION_OPTIMIZE_REFERENCES).map(async (item) => ({
        ...item,
        url: item.url.startsWith("/")
          ? await localImageUrlToDataUrl(item.url, { maxEdge: 1024, quality: 82, format: "jpeg" })
          : item.url,
      })),
    );

    try {
      const attachmentPrompt = formatAttachmentsForPrompt(input.attachments);
      const optimizedPrompt = await optimizePromptByRelay({
        model: input.model || settings.promptOptimizerModel,
        prompt: [input.prompt, attachmentPrompt].filter(Boolean).join("\n\n"),
        userMessage: input.userMessage,
        selectedImageUrl,
        referenceImageUrls: input.referenceImageUrls,
        referenceImages,
        conversation: input.conversation,
      });

      return NextResponse.json({
        ok: true,
        optimizedPrompt,
        reply: "已根据当前对话、选中图片和分类参考图优化提示词。",
        usedFallback: false,
      });
    } catch (error) {
      const optimizedPrompt = fallbackOptimize(input);
      return NextResponse.json({
        ok: true,
        optimizedPrompt,
        reply: `文本模型暂不可用，已使用本地规则优化。${getShortErrorReason(error)}`,
        usedFallback: true,
        upstreamStatus: getUpstreamStatus(error),
      });
    }
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes("请先输入正确口令") ? 401 : message.includes("无权") || message.includes("跨站") ? 403 : 400;

    return NextResponse.json(
      {
        ok: false,
        error: "PROMPT_OPTIMIZE_FAILED",
        message,
        shortReason: getShortErrorReason(error),
      },
      { status },
    );
  }
}
