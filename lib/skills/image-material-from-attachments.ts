import { chatByRelay, type RelayChatMessage } from "@/lib/ai/relay-provider";
import { AttachmentMaterialSchema, type AttachmentMaterial, type RuntimeSkill } from "./types";

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: string, max: number) {
  return cleanText(value).slice(0, max);
}

function clampList(values: unknown, maxItems: number, maxChars: number) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const text = clamp(String(value ?? ""), maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) break;
  }

  return output;
}

function splitSentences(text: string) {
  return cleanText(text)
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function extractByKeywords(sentences: string[], keywords: string[], max: number) {
  return clampList(
    sentences.filter((sentence) => keywords.some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()))),
    max,
    160,
  );
}

function normalizeMaterial(value: Partial<AttachmentMaterial>, fallbackSummary: string): AttachmentMaterial {
  const tables = Array.isArray(value.tables)
    ? value.tables.slice(0, 8).map((table) => ({
        name: clamp(table?.name || "Sheet", 120),
        columns: clampList(table?.columns, 24, 80),
        sampleRows: clampList(table?.sampleRows, 8, 220),
        notes: clampList(table?.notes, 8, 160),
      }))
    : [];

  return AttachmentMaterialSchema.parse({
    summary: clamp(value.summary || fallbackSummary, 1800),
    keyFacts: clampList(value.keyFacts, 12, 180),
    entities: clampList(value.entities, 12, 120),
    visualNotes: clampList(value.visualNotes, 12, 180),
    tables,
    promptHints: clampList(value.promptHints, 14, 220),
    warnings: clampList(value.warnings, 10, 180),
  });
}

function fallbackAnalyze(input: Parameters<RuntimeSkill["run"]>[0], warning?: string): AttachmentMaterial {
  const text = input.text || "";
  const sentences = splitSentences(text);
  const summary =
    input.kind === "IMAGE"
      ? `图片素材 ${input.name} 已上传，可作为视觉参考、主体参考或风格参考。`
      : clamp(sentences.slice(0, 5).join(" ") || `${input.name} 已上传，但可读内容较少。`, 1200);

  const keyFacts = [
    ...extractByKeywords(sentences, ["品牌", "产品", "卖点", "目标", "用户", "价格", "时间", "地点", "活动", "规格"], 8),
    ...(input.tables || []).flatMap((table) => table.notes),
  ];
  const entities = [
    ...extractByKeywords(sentences, ["人物", "主体", "产品", "场景", "建筑", "山", "水", "空间", "包装", "海报"], 8),
    ...(input.tables || []).flatMap((table) => table.columns.slice(0, 8)),
  ];
  const visualNotes =
    input.kind === "IMAGE"
      ? ["保留图片中的核心主体、构图气质和主要色彩关系。", "图片附件作为综合视觉参考，不强制拆成分类参考图。"]
      : extractByKeywords(sentences, ["风格", "颜色", "色彩", "材质", "光线", "构图", "氛围", "高级", "简洁", "东方", "水墨"], 10);

  return normalizeMaterial(
    {
      summary,
      keyFacts,
      entities,
      visualNotes,
      tables: input.tables || [],
      promptHints: [
        entities.length ? `画面主体可参考：${clampList(entities, 6, 80).join("、")}` : "",
        visualNotes.length ? `视觉风格参考：${clampList(visualNotes, 5, 100).join("；")}` : "",
        keyFacts.length ? `内容信息参考：${clampList(keyFacts, 5, 100).join("；")}` : "",
        `素材类型：${input.kind}，摘要：${summary.slice(0, 180)}`,
      ].filter(Boolean),
      warnings: warning ? [warning] : [],
    },
    summary,
  );
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON。");
  return JSON.parse(text.slice(start, end + 1)) as Partial<AttachmentMaterial>;
}

async function gptAnalyze(input: Parameters<RuntimeSkill["run"]>[0]) {
  const tableText = input.tables?.length
    ? input.tables
        .map((table) => `${table.name}\n字段：${table.columns.join("、")}\n样例：${table.sampleRows.join(" | ")}`)
        .join("\n\n")
    : "";
  const content = [input.text || "", tableText].filter(Boolean).join("\n\n").slice(0, 12000);

  if (!content && input.kind !== "IMAGE") {
    throw new Error("没有可分析文本。");
  }

  if (input.kind === "IMAGE") {
    return fallbackAnalyze(input);
  }

  const messages: RelayChatMessage[] = [
    {
      role: "system",
      content:
        "你是图像生成应用的素材分析 skill。请根据用户上传附件内容，判断适合生成什么样的图片，并输出严格 JSON。不要输出 Markdown。",
    },
    {
      role: "user",
      content: `文件名：${input.name}
类型：${input.kind}

请输出 JSON，字段必须是：
summary: string，概括附件内容和可用于生图的方向；
keyFacts: string[]，品牌、产品、卖点、人群、时间地点等事实；
entities: string[]，适合画面化的主体、人物、物体、场景，每项不要超过 40 个汉字；
visualNotes: string[]，风格、色彩、材质、构图、光线、情绪建议；
tables: array，保留表格摘要，没有则空数组；
promptHints: string[]，可直接拼入生图 prompt 的中文短句；
warnings: string[]，不确定或缺失信息。

附件内容：
${content}`,
    },
  ];

  const reply = await chatByRelay({
    model: input.model || process.env.AI_TEXT_MODEL || "gpt-5.4",
    messages,
  });

  return normalizeMaterial(extractJson(reply), `${input.name} 已完成智能素材分析。`);
}

export const imageMaterialFromAttachmentsSkill: RuntimeSkill = {
  name: "image-material-from-attachments",
  version: "1.1.0",
  inputKinds: ["IMAGE", "DOCUMENT", "SPREADSHEET", "TEXT", "OTHER"],
  async run(input) {
    try {
      return await gptAnalyze(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "智能分析失败";
      return fallbackAnalyze(input, `已使用本地规则完成素材分析：${reason}`);
    }
  },
};
