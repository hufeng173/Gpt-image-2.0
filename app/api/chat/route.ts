import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { chatByRelay, type RelayChatMessage } from "@/lib/ai/relay-provider";
import { getAppSettings } from "@/lib/settings";
import { getErrorMessage, getShortErrorReason, getUpstreamStatus } from "@/lib/error-reason";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
});

const ChatSchema = z.object({
  message: z.string().min(1).max(12000),
  model: z.string().optional(),
  conversation: z.array(ChatMessageSchema).max(50).optional().default([]),
  mode: z.enum(["chat", "image-assistant"]).optional().default("chat"),
  selectedImageUrl: z.string().optional(),
});

function buildSystemPrompt(mode: "chat" | "image-assistant") {
  if (mode === "image-assistant") {
    return "你是 EastWill 太极图的图像创作助理。你可以和用户像 ChatGPT 一样对话，但回答要服务于 AI 作图：帮助用户拆解画面目标、优化提示词、分析构图、配色、材质、光线，并给出下一步可执行建议。回答简洁、明确、可操作。";
  }

  return "你是 EastWill 太极图的通用对话助手，使用中文回答。回答应像 ChatGPT 官方网页那样自然、清晰、可继续追问。若用户讨论作图，请主动帮助其形成可执行的提示词。";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = ChatSchema.parse(body);
    const settings = await getAppSettings();

    const messages: RelayChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(input.mode),
      },
      ...input.conversation.slice(-20).map((item): RelayChatMessage => ({
        role: item.role,
        content: item.content,
      })),
      {
        role: "user",
        content: input.selectedImageUrl
          ? `${input.message}\n\n当前选中图片：${input.selectedImageUrl}`
          : input.message,
      },
    ];

    const reply = await chatByRelay({
      model: input.model || settings.promptOptimizerModel || process.env.AI_TEXT_MODEL || "gpt-5.4",
      messages,
    });

    return NextResponse.json({
      ok: true,
      reply: reply || "我已收到。",
      model: input.model || settings.promptOptimizerModel,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "CHAT_FAILED",
        message: getErrorMessage(error),
        shortReason: getShortErrorReason(error),
        upstreamStatus: getUpstreamStatus(error),
      },
      { status: 502 },
    );
  }
}
