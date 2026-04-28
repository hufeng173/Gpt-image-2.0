# 太极图 V3 完整替换包

## 已完成需求

1. 当前图片可以选中，右侧“选中图片单独优化”区域可对该图片进行对话式优化，并生成新版本。
2. 默认负面提示词为空。
3. 生成张数 1-4 已在后端实现：后端会按指定张数循环生成，避免模型忽略 n 参数。
4. 最大并发可在设置中调整，默认 8，最高 12；适合 30 人团队内部使用。失败会返回 `shortReason`。
5. 已实现上下文对话和提示词优化：`/api/prompt/optimize`。
6. 已实现示例/参考图片上传：`/api/uploads`，保存到 `public/uploads/`。
7. 生成图支持 PNG 下载和 JPEG 下载。
8. 支持模型选择：默认包含 `gpt-image-2`、`gpt-image-1`、`banana`、`nano-banana`、`dall-e-3`。
9. 支持默认尺寸和自定义尺寸。自定义尺寸最终由上游模型决定是否支持。
10. 项目图片全部使用本地图片，放置在 `public/brand/`。

## 替换文件清单

请把压缩包中的文件复制到项目根目录覆盖：

- `app/layout.tsx`
- `app/page.tsx`
- `app/globals.css`
- `app/api/health/route.ts`
- `app/api/images/generate/route.ts`
- `app/api/uploads/route.ts`
- `app/api/prompt/optimize/route.ts`
- `app/api/settings/route.ts`
- `lib/prisma.ts`
- `lib/concurrency.ts`
- `lib/error-reason.ts`
- `lib/image-files.ts`
- `lib/settings.ts`
- `lib/ai/relay-provider.ts`
- `prisma/schema.prisma`
- `postcss.config.mjs`
- `public/brand/README.md`

## 重要说明

本包没有修改 `package.json`，避免再次删除你现有依赖。你当前项目已经有 `next`、`react`、`openai`、`zod`、`nanoid`、`prisma`、`@prisma/client`，这些就够用。

## 替换后执行

```powershell
cd "E:\Project_code\VScode\image2.0"
Remove-Item -Recurse -Force ".next"
pnpm prisma generate
pnpm dev
```

不要执行新的 Prisma migrate。本包使用的是与你当前数据库兼容的旧 schema，没有 `updatedAt` 字段。

## 环境变量

`.env.local` 保持：

```env
AI_RELAY_BASE_URL="https://tokens.byteseek.ai/v1"
AI_RELAY_API_KEY="你的新 key"
AI_IMAGE_MODEL="gpt-image-2"
AI_TEXT_MODEL="gpt-5.2"
```

`AI_TEXT_MODEL` 可选，用于提示词优化；如果不填，默认使用 `gpt-5.2`。
