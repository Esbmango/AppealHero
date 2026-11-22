import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AssistantHistorySchema } from '@appealhero/shared';
import { assistantReply } from '../assistant';
import { HttpError } from '../core/util';
import { readForm } from './uploads';

const IMAGE_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/heic': '.heic' };

/**
 * Free-form assistant. Stateless: the browser keeps the conversation and sends recent turns with each message.
 * Uploaded screenshots are processed in a temporary folder and deleted right after the reply (they can hold the
 * driver's real plate). The assistant has no tools: it cannot browse, submit, approve or confirm anything.
 */
export function registerAssistantRoutes(app: FastifyInstance) {
  app.post('/api/assistant', async (req) => {
    const { fields, files } = await readForm(req);
    const images = files.filter((f) => f.field === 'images');
    if (images.length > 3) throw new HttpError(400, 'Upload at most 3 screenshots.');
    if (images.some((f) => !IMAGE_TYPES[f.mime])) throw new HttpError(415, 'Screenshots must be PNG, JPEG, WebP or HEIC.');
    const text = (fields.text ?? '').slice(0, 4000);
    if (!text.trim() && !images.length) throw new HttpError(400, 'Type a message or upload a screenshot.');
    let history;
    try {
      history = AssistantHistorySchema.parse(JSON.parse(fields.history || '[]'));
    } catch {
      throw new HttpError(400, 'history must be a JSON array of { role, text } turns');
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `appealhero-assistant-${randomUUID().slice(0, 8)}-`));
    try {
      const uploads = images.map((image, i) => {
        const file = path.join(dir, `shot-${i}${IMAGE_TYPES[image.mime]}`);
        fs.writeFileSync(file, image.buffer);
        return { path: file, mime: image.mime };
      });
      return await assistantReply({ lang: fields.lang ?? 'zh', history, text, images: uploads });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
