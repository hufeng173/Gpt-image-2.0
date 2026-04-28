import OpenAI from "openai";

const baseURL = process.env.AI_RELAY_BASE_URL;
const apiKey = process.env.AI_RELAY_API_KEY;

if (!baseURL) {
  throw new Error("Missing AI_RELAY_BASE_URL");
}

if (!apiKey) {
  throw new Error("Missing AI_RELAY_API_KEY");
}

const relayClient = new OpenAI({
  baseURL,
  apiKey,
});

export type GenerateImageInput = {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  count?: number;
};

export type RelayImageItem = {
  url?: string | null;
  b64_json?: string | null;
  revised_prompt?: string | null;
};

export async function generateImageByRelay(input: GenerateImageInput): Promise<RelayImageItem[]> {
  const result = await relayClient.images.generate({
    model: process.env.AI_IMAGE_MODEL || "gpt-image-2",
    prompt: input.prompt,
    size: input.size || "1024x1024",
    n: input.count || 1,
  });

  return (result.data || []) as RelayImageItem[];
}
