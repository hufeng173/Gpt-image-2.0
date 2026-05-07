import OpenAI from "openai";
import { toFile } from "openai/uploads";

export type RelayImageItem = {
  url?: string | null;
  b64_json?: string | null;
  revised_prompt?: string | null;
};

export type RelayChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export const relayClient = new OpenAI({
  apiKey: process.env.AI_RELAY_API_KEY,
  baseURL: process.env.AI_RELAY_BASE_URL,
});

export async function generateImageByRelay(input: {
  model?: string;
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  count?: number;
}) {
  const result = await relayClient.images.generate({
    model: input.model || process.env.AI_IMAGE_MODEL || "gpt-image-2",
    prompt: input.prompt,
    size: input.size || "1024x1024",
    n: input.count || 1,
  });

  return (result.data || []) as RelayImageItem[];
}

export async function editImageByRelay(input: {
  model?: string;
  prompt: string;
  imageBuffer?: Buffer;
  imageBuffers?: Buffer[];
  fileName?: string;
  mimeType?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  count?: number;
}) {
  const imageBuffers = input.imageBuffers || (input.imageBuffer ? [input.imageBuffer] : []);
  if (imageBuffers.length === 0) throw new Error("图片编辑需要至少一张参考图。");

  const files = await Promise.all(
    imageBuffers.slice(0, 16).map((buffer, index) =>
      toFile(buffer, index === 0 ? input.fileName || "reference.png" : `reference-${index + 1}.png`, {
        type: input.mimeType || "image/png",
      }),
    ),
  );

  const result = await relayClient.images.edit({
    model: input.model || process.env.AI_IMAGE_MODEL || "gpt-image-2",
    image: files.length === 1 ? files[0] : files,
    prompt: input.prompt,
    size: input.size || "1024x1024",
    n: input.count || 1,
    input_fidelity: "high",
  });

  return (result.data || []) as RelayImageItem[];
}

export async function chatByRelay(input: {
  model?: string;
  messages: RelayChatMessage[];
}) {
  const result = await relayClient.chat.completions.create({
    model: input.model || process.env.AI_TEXT_MODEL || "gpt-5.4",
    messages: input.messages as never,
  });

  return result.choices[0]?.message?.content?.trim() || "";
}

export async function optimizePromptByRelay(input: {
  model?: string;
  prompt: string;
  userMessage?: string;
  selectedImageUrl?: string;
  referenceImageUrls?: string[];
  referenceImages?: Array<{
    category: string;
    url: string;
    name?: string;
  }>;
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}) {
  const referenceText = [
    input.selectedImageUrl ? `当前选中图片：${input.selectedImageUrl}` : "",
    input.referenceImages?.length
      ? `分类参考图：${input.referenceImages
          .map((item) => `${item.category}:${item.url}`)
          .join("；")}`
      : "",
    input.referenceImageUrls?.length
      ? `普通参考图：${input.referenceImageUrls.join("，")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: RelayChatMessage[] = [
    {
      role: "system",
      content:
        "你是 EastWill 太极图的专业 AI 作图提示词优化助手。请输出一段可直接用于图像生成模型的中文提示词。要求：画面具体、结构清晰、视觉层级明确、能体现构图/配色/材质/光线等细节。不要解释，不要输出多余寒暄。",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `原始提示词：${input.prompt}`,
            input.userMessage ? `用户补充要求：${input.userMessage}` : "",
            referenceText,
            input.conversation?.length
              ? `最近上下文：\n${input.conversation
                  .slice(-10)
                  .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`)
                  .join("\n")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
        ...(input.selectedImageUrl ? [{ type: "image_url" as const, image_url: { url: input.selectedImageUrl } }] : []),
        ...(input.referenceImages || []).slice(0, 8).map((item) => ({
          type: "image_url" as const,
          image_url: { url: item.url },
        })),
      ],
    },
  ];

  return chatByRelay({ model: input.model, messages });
}
