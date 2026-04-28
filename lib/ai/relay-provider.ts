import OpenAI from "openai";

export const relayClient = new OpenAI({
  apiKey: process.env.AI_RELAY_API_KEY,
  baseURL: process.env.AI_RELAY_BASE_URL,
});

export async function generateImageByRelay(input: {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  count?: number;
}) {
  const result = await relayClient.images.generate({
    model: process.env.AI_IMAGE_MODEL || "gpt-image-1",
    prompt: input.prompt,
    size: input.size || "1024x1024",
    n: input.count || 1,
  });

  return result.data;
}