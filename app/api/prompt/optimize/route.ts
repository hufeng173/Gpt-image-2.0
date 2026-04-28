import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { optimizePromptByRelay } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const OptimizeSchema = z.object({
  prompt: z.string().min(1).max(4000),
  negative: z.string().optional(),
  userMessage: z.string().optional(),
  selectedImageUrl: z.string().optional(),
  referenceImageUrls: z.array(z.string()).max(8).optional(),
  conversation: z.array(ChatMessageSchema).max(20).optional(),
  model: z.string().optional(),
});

function fallbackOptimize(input: z.infer<typeof OptimizeSchema>) {
  const extras = [
    "东方美学",
    "高级商业视觉",
    "留白构图",
    "细腻光影",
    "画面干净",
    "质感真实",
    "细节丰富",
  ].join("，");

  const referenceNote = input.selectedImageUrl || input.referenceImageUrls?.length
    ? "，参考已上传图片的主体、构图或风格进行延展"
    : "";

  return `${input.prompt}，${extras}${referenceNote}`;
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
        conversation: input.conversation,
      });

      return NextResponse.json({
        ok: true,
        optimizedPrompt,
        reply: "已根据上下文和参考信息优化提示词。",
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
