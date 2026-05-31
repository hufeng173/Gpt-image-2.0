import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { chatByRelay, type RelayChatMessage } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";
import { localImageUrlToDataUrl } from "@/lib/image-files";
import { requireAccessSession } from "@/lib/access-control";
import { formatAttachmentsForPrompt } from "@/lib/attachments";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
});

const AttachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  summary: z.string().optional(),
  url: z.string().nullable().optional(),
  materials: z.unknown().optional(),
});

const ChatSchema = z.object({
  message: z.string().min(1).max(12000),
  model: z.string().optional(),
  conversation: z.array(ChatMessageSchema).max(50).optional().default([]),
  mode: z.enum(["chat", "image-assistant"]).optional().default("chat"),
  selectedImageUrl: z.string().optional(),
  attachments: z.array(AttachmentSchema).max(12).optional().default([]),
});

function buildSystemPromptForRequest(mode: "chat" | "image-assistant", hasVisualInput: boolean) {
  if (mode === "image-assistant") {
    return [
      "你是 EastWill 太极图的图像创作助手。你可以像 ChatGPT 一样正常对话，也可以帮助用户拆解作图目标、优化提示词、分析构图、配色、材质和光线。",
      hasVisualInput
        ? "本轮请求带有用户明确选择或上传的图片时，才可以分析图片内容。"
        : "本轮请求没有用户明确选择或上传的图片。禁止声称你看到了图片，禁止使用“这张图”“图中”“画面里已有”等表述；按普通文本问题回答，只有用户要求作图时才给提示词建议。",
      "回答要简洁、明确、可操作。",
    ].join("\n");
  }

  return "你是 EastWill 太极图的通用对话助手，使用中文回答。回答应自然、清晰、可继续追问。若用户讨论作图，请帮助其形成可执行的提示词。";
}

function fallbackReply(input: z.infer<typeof ChatSchema>) {
  if (input.mode === "image-assistant") {
    return [
      "文本模型这次没有返回有效内容，我先给你一个本地可用的作图方向：",
      `围绕“${input.message}”，建议明确主体、环境、构图、光线和材质。`,
      "可以继续补充：画面主体是谁、风格偏写实还是插画、横图或竖图、是否参考当前选中图片。",
    ].join("\n");
  }

  return `文本模型这次没有返回有效内容。我已收到你的问题：“${input.message}”。你可以继续发送更具体的要求，我会继续处理。`;
}

async function imageUrlToOptionalDataUrl(url?: string | null) {
  if (!url) return "";
  if (!url.startsWith("/")) return url;

  try {
    return await localImageUrlToDataUrl(url, { maxEdge: 1024, quality: 82, format: "jpeg" });
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAccessSession(request);
    const body = await request.json();
    const input = ChatSchema.parse(body);
    const settings = await getAppSettings();
    const selectedImageDataUrl = await imageUrlToOptionalDataUrl(input.selectedImageUrl);
    const imageAttachmentDataUrls = await Promise.all(
      input.attachments
        .filter((item) => item.kind === "IMAGE" && item.url)
        .slice(0, 6)
        .map(async (item) => imageUrlToOptionalDataUrl(item.url)),
    );
    const hasVisualInput = Boolean(selectedImageDataUrl || imageAttachmentDataUrls.some(Boolean));
    const attachmentContext = formatAttachmentsForPrompt(input.attachments);
    const userText = [input.message, attachmentContext].filter(Boolean).join("\n\n");

    const messages: RelayChatMessage[] = [
      {
        role: "system",
        content: buildSystemPromptForRequest(input.mode, hasVisualInput),
      },
      ...input.conversation.slice(-20).map((item): RelayChatMessage => ({
        role: item.role,
        content: item.content,
      })),
      {
        role: "user",
        content: selectedImageDataUrl || imageAttachmentDataUrls.length > 0
          ? [
              { type: "text", text: userText },
              ...(selectedImageDataUrl ? [{ type: "image_url" as const, image_url: { url: selectedImageDataUrl } }] : []),
              ...imageAttachmentDataUrls.filter(Boolean).map((url) => ({ type: "image_url" as const, image_url: { url } })),
            ]
          : userText,
      },
    ];

    let reply: string;
    let usedFallback = false;

    try {
      reply = await chatByRelay({
        model: input.model || settings.promptOptimizerModel || process.env.AI_TEXT_MODEL || "gpt-5.4",
        messages,
      });
    } catch {
      reply = fallbackReply(input);
      usedFallback = true;
    }

    return NextResponse.json({
      ok: true,
      reply: reply || "我已收到。",
      model: input.model || settings.promptOptimizerModel,
      usedFallback,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes("璇峰厛杈撳叆姝ｇ‘鍙ｄ护") ? 401 : message.includes("鏃犳潈") || message.includes("璺ㄧ珯") ? 403 : 502;

    return NextResponse.json(
      {
        ok: false,
        error: "CHAT_FAILED",
        message,
        shortReason: getShortErrorReason(error),
        upstreamStatus: getUpstreamStatus(error),
      },
      { status },
    );
  }
}
