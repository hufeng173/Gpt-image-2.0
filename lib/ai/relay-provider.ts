import OpenAI, { toFile } from "openai";
import type { PublicImageFile } from "@/lib/image-files";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | `${number}x${number}`;

export type RelayImageItem = {
  url?: string | null;
  b64_json?: string | null;
  revised_prompt?: string | null;
};

function getRelayClient() {
  const baseURL = process.env.AI_RELAY_BASE_URL;
  const apiKey = process.env.AI_RELAY_API_KEY;

  if (!baseURL) throw new Error("Missing AI_RELAY_BASE_URL");
  if (!apiKey) throw new Error("Missing AI_RELAY_API_KEY");

  return new OpenAI({ baseURL, apiKey });
}

export async function generateImageByRelay(input: {
  model: string;
  prompt: string;
  size: ImageSize;
}): Promise<RelayImageItem[]> {
  const relayClient = getRelayClient();
  const result = await relayClient.images.generate({
    model: input.model,
    prompt: input.prompt,
    size: input.size as never,
    n: 1,
  });

  return (result.data || []) as RelayImageItem[];
}

export async function editImageByRelay(input: {
  model: string;
  prompt: string;
  size: ImageSize;
  referenceImage: PublicImageFile;
}): Promise<RelayImageItem[]> {
  const relayClient = getRelayClient();
  const imageFile = await toFile(input.referenceImage.buffer, input.referenceImage.fileName, {
    type: input.referenceImage.mimeType,
  });

  const result = await relayClient.images.edit({
    model: input.model,
    image: imageFile,
    prompt: input.prompt,
    size: input.size as never,
    n: 1,
  } as never);

  return (result.data || []) as RelayImageItem[];
}

export async function optimizePromptByRelay(input: {
  model: string;
  prompt: string;
  negative?: string;
  userMessage?: string;
  selectedImageUrl?: string;
  referenceImageUrls?: string[];
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const relayClient = getRelayClient();
  const conversationText = (input.conversation || [])
    .slice(-10)
    .map((item) => `${item.role === "user" ? "用户" : "太极图"}：${item.content}`)
    .join("\n");

  const referenceText = [input.selectedImageUrl, ...(input.referenceImageUrls || [])]
    .filter(Boolean)
    .map((url, index) => `参考图${index + 1}：${url}`)
    .join("\n");

  const result = await relayClient.chat.completions.create({
    model: input.model,
    messages: [
      {
        role: "system",
        content:
          "你是 EastWill 的太极图提示词优化师。请把用户的中文需求优化为适合作图模型的高质量中文提示词。只输出优化后的提示词，不要输出解释。风格要求：简约、高雅、东方美学、留白、商业可用。",
      },
      {
        role: "user",
        content: [
          `当前主提示词：${input.prompt}`,
          input.negative ? `负面提示词：${input.negative}` : "负面提示词：无",
          input.userMessage ? `本轮优化要求：${input.userMessage}` : "本轮优化要求：请增强画面质量和构图。",
          conversationText ? `上下文对话：\n${conversationText}` : "上下文对话：无",
          referenceText ? `参考图信息：\n${referenceText}` : "参考图信息：无",
          "请输出一个完整、可直接用于 AI 作图的提示词。",
        ].join("\n\n"),
      },
    ],
  });

  return result.choices?.[0]?.message?.content?.trim() || input.prompt;
}
