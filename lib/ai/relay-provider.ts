import OpenAI, { toFile } from "openai";

export type RelayImageItem = {
  url?: string | null;
  b64_json?: string | null;
  revised_prompt?: string | null;
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
  imageBuffer: Buffer;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  count?: number;
}) {
  const file = await toFile(input.imageBuffer, "reference.png", {
    type: "image/png",
  });

  const result = await relayClient.images.edit({
    model: input.model || process.env.AI_IMAGE_MODEL || "gpt-image-2",
    image: file,
    prompt: input.prompt,
    size: input.size || "1024x1024",
    n: input.count || 1,
  });

  return (result.data || []) as RelayImageItem[];
}

export async function optimizePromptByRelay(input: {
  model?: string;
  prompt: string;
  negative?: string;
  userMessage?: string;
  selectedImageUrl?: string;
  referenceImageUrls?: string[];
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}) {
  const messages = [
    {
      role: "system" as const,
      content:
        "你是 EastWill 太极图的专业 AI 作图提示词优化助手。请输出一段可直接用于图像生成模型的中文提示词，要求结构清晰、画面具体、风格高级、避免空泛。",
    },
    {
      role: "user" as const,
      content: [
        `原始提示词：${input.prompt}`,
        input.negative ? `负面提示词：${input.negative}` : "",
        input.userMessage ? `用户补充要求：${input.userMessage}` : "",
        input.selectedImageUrl ? `当前选中图片：${input.selectedImageUrl}` : "",
        input.referenceImageUrls?.length
          ? `参考图片：${input.referenceImageUrls.join(", ")}`
          : "",
        input.conversation?.length
          ? `上下文：${input.conversation
              .slice(-8)
              .map((item) => `${item.role}: ${item.content}`)
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const result = await relayClient.chat.completions.create({
    model: input.model || process.env.AI_TEXT_MODEL || "gpt-5.2",
    messages,
  });

  return result.choices[0]?.message?.content?.trim() || input.prompt;
}