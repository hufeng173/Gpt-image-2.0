---
name: image2-attachment-skill-dev
description: Maintain image2.0 attachment parsing, material extraction, and prompt injection safely.
---

# image2.0 Attachment Skill Development

Use this skill when extending the image2.0 attachment-to-image workflow.

## Key Files

- `app/page.tsx`: primary workspace UI and attachment state.
- `app/api/uploads/route.ts`: upload, parse, persist, and return attachments.
- `app/api/chat/route.ts`: chat context assembly.
- `app/api/images/generate/route.ts`: image prompt assembly and reference-image handling.
- `app/api/prompt/optimize/route.ts`: prompt optimization context.
- `lib/attachments.ts`: file type detection, parsing orchestration, prompt formatting.
- `lib/skills/registry.ts`: runtime skill whitelist.
- `lib/skills/image-material-from-attachments.ts`: project material extraction skill.
- `lib/image-files.ts`: image validation and preparation helpers.
- `prisma/schema.prisma`: persisted conversations, image jobs, and attachments.

## Extension Rules

- Add new file types first in `lib/attachments.ts`.
- Register new runtime skills only through `lib/skills/registry.ts`.
- Keep skill output bounded and validated before passing it into chat or image prompts.
- Do not store full long documents in message JSON; store attachment references and summaries.
- Do not execute external skill scripts directly from a web request.
- Do not allow uploaded files to trigger shell commands, project file edits, hidden path reads, or environment access.
- Preserve the old categorized reference-image flow: `composition`, `color`, `material`, `lighting`, `other`.
- Database migrations must be intentional and verified.

## Verification

- Upload PNG/JPEG/WebP, PDF, DOCX, TXT/Markdown, XLSX, and CSV.
- Confirm invalid and oversized files are rejected with stable JSON responses.
- Confirm parsed output includes `summary`, `keyFacts`, `entities`, `visualNotes`, `tables`, `promptHints`, and `warnings`.
- Confirm chat can answer from attachments.
- Confirm image generation includes attachment material hints.
- Confirm prompt optimization includes attachment material hints.
- Confirm old categorized references, single-image optimization, and multi-image generation still work.
- Run `pnpm lint`, `pnpm build`, and `pnpm prisma:generate` after schema changes.
