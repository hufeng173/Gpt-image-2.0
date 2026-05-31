# Skills Directory

This directory stores project-approved skill references and runtime skill manifests for the image2.0 workspace.

## Rules

- Third-party skills copied from external sources are references until they are reviewed and adapted.
- Runtime skills must be registered in `lib/skills/registry.ts`.
- Runtime skills must expose typed TypeScript functions only. They must not run arbitrary shell commands.
- Runtime skills may read only the uploaded file buffer and explicit metadata passed by the API layer.
- Runtime skills must return bounded, schema-validated material summaries before their output can enter chat or image prompts.
- External scripts, remote downloads, hidden file access, project file mutation, and environment-variable reads are not allowed from user-triggered skill execution.

## Current Runtime Skill

- `image-material-from-attachments`: converts uploaded images, documents, and spreadsheets into structured material briefs for chat and image generation.
