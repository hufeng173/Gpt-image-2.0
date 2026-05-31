import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ImageModelOption = {
  id: string;
  name: string;
  note?: string;
};

export type TextModelOption = {
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
  textModels: TextModelOption[];
};

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentGenerations: 8,
  defaultImageModel: process.env.AI_IMAGE_MODEL || "gpt-image-2",
  promptOptimizerModel: process.env.AI_TEXT_MODEL || "gpt-5.4",
  allowReferenceImageEdit: true,
  imageModels: [
    { id: "gpt-image-2", name: "GPT Image 2", note: "推荐" },
    { id: "gpt-image-1.5", name: "GPT Image 1.5" },
    { id: "gpt-image-1", name: "GPT Image 1" },
  ],
  textModels: [
    { id: "gpt-5.5", name: "GPT-5.5", note: "高质量附件理解" },
    { id: "gpt-5.4", name: "GPT-5.4", note: "默认推荐" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", note: "轻量快速" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", note: "开发代理" },
    { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { id: "gpt-5.2", name: "GPT-5.2" },
  ],
};

const SETTINGS_FILE = path.join(process.cwd(), "data", "settings.json");

function mergeModelOptions<T extends { id: string; name: string }>(defaults: T[], configured?: T[]) {
  const byId = new Map<string, T>();
  for (const item of defaults) byId.set(item.id, item);
  for (const item of configured || []) {
    if (item?.id && item?.name) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  const maxConcurrentGenerations = Math.min(
    20,
    Math.max(1, Number(value.maxConcurrentGenerations || DEFAULT_SETTINGS.maxConcurrentGenerations)),
  );

  const imageModels = mergeModelOptions(DEFAULT_SETTINGS.imageModels, value.imageModels);
  const textModels = mergeModelOptions(DEFAULT_SETTINGS.textModels, value.textModels);

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    maxConcurrentGenerations,
    imageModels,
    textModels,
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
