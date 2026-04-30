import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ImageModelOption = {
  id: string;
  name: string;
  note?: string;
};

export type AppSettings = {
  maxConcurrentGenerations: number;
  defaultImageModel: string;
  promptOptimizerModel: string;
  allowReferenceImageEdit: boolean;
  imageModels: ImageModelOption[];
};

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentGenerations: 8,
  defaultImageModel: process.env.AI_IMAGE_MODEL || "gpt-image-2",
  promptOptimizerModel: process.env.AI_TEXT_MODEL || "gpt-5.4",
  allowReferenceImageEdit: true,
  imageModels: [
    { id: "gpt-image-2", name: "GPT Image 2", note: "推荐" },

  ],
};

const SETTINGS_FILE = path.join(process.cwd(), "data", "settings.json");

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const maxConcurrentGenerations = Math.min(
    16,
    Math.max(1, Number(value.maxConcurrentGenerations || DEFAULT_SETTINGS.maxConcurrentGenerations)),
  );

  const imageModels = Array.isArray(value.imageModels) && value.imageModels.length > 0
    ? value.imageModels.filter((item) => item?.id && item?.name)
    : DEFAULT_SETTINGS.imageModels;

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    maxConcurrentGenerations,
    imageModels,
    defaultImageModel: value.defaultImageModel || process.env.AI_IMAGE_MODEL || DEFAULT_SETTINGS.defaultImageModel,
    promptOptimizerModel: value.promptOptimizerModel || process.env.AI_TEXT_MODEL || DEFAULT_SETTINGS.promptOptimizerModel,
    allowReferenceImageEdit: value.allowReferenceImageEdit ?? DEFAULT_SETTINGS.allowReferenceImageEdit,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf8");
    return normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export async function saveAppSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const next = normalizeSettings({ ...current, ...input });
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}
