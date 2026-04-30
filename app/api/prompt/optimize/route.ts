import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { optimizePromptByRelay } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const ReferenceImageSchema = z.object({
  category: z.enum(["composition", "color", "material", "lighting", "other"]),
  url: z.string().min(1),
  name: z.string().optional(),
});

const OptimizeSchema = z.object({
  prompt: z.string().min(1).max(6000),
  negative: z.string().optional(),
  userMessage: z.string().optional(),
  selectedImageUrl: z.string().optional(),
  referenceImageUrls: z.array(z.string()).max(20).optional(),
  referenceImages: z.array(ReferenceImageSchema).max(20).optional(),
  conversation: z.array(ChatMessageSchema).max(40).optional(),
  model: z.string().optional(),
});

function fallbackOptimize(input: z.infer<typeof OptimizeSchema>) {
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

  return `${input.prompt}，${extras}${selectedNote}${referenceNote}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = OptimizeSchema.parse(body);
    const settings = await getAppSettings();

    try {
      const optimizedPrompt = await optimizePromptByRelay({
        model: input.model || settings.promptOptimizerModel,
        prompt: input.prompt,
        negative: input.negative,
        userMessage: input.userMessage,
        selectedImageUrl: input.selectedImageUrl,
        referenceImageUrls: input.referenceImageUrls,
        referenceImages: input.referenceImages,
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
    return NextResponse.json(
      {
        ok: false,
        error: "PROMPT_OPTIMIZE_FAILED",
        message: getErrorMessage(error),
        shortReason: getShortErrorReason(error),
      },
      { status: 400 },
    );
  }
}
