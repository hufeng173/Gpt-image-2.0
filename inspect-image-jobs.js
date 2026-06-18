const fs = require('fs');
const path = require('path');
for (const name of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    v = v.replace(/^['"]|['"]$/g, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.imageJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      model: true,
      prompt: true,
      size: true,
      count: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      finishedAt: true,
      rawResponse: true,
      images: { select: { url: true, width: true, height: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  for (const r of rows) {
    const raw = r.rawResponse || {};
    console.log('---JOB---');
    console.log(JSON.stringify({
      id: r.id,
      model: r.model,
      size: r.size,
      count: r.count,
      status: r.status,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      promptLength: r.prompt ? r.prompt.length : 0,
      promptPreview: (r.prompt || '').slice(0, 300),
      rawKeys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
      rawRequestedSize: raw.requestedSize,
      rawModelSize: raw.modelSize,
      rawImages: raw.images,
      rawFailures: raw.failures,
      rawNotes: raw.notes,
      rawWarnings: raw.warnings,
      images: r.images,
    }, null, 2));
  }
})().finally(() => prisma.$disconnect());
