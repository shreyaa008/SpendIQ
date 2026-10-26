// Topic 34/35: fs + path + streams for receipt files. Files live under uploads/<userId>/ with random names.
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { env } from '../config/env.js';

export const uploadRoot = () => path.resolve(env.uploadDir);

function resolveSafe(key) {
  const full = path.resolve(uploadRoot(), key);
  if (!full.startsWith(uploadRoot() + path.sep)) throw new Error('Invalid storage key'); // path-traversal guard
  return full;
}

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

export async function saveReceiptFile(userId, buffer, ext) {
  const key = path.join(String(userId), `${randomBytes(16).toString('hex')}.${ext}`);
  const full = resolveSafe(key);
  await mkdir(path.dirname(full), { recursive: true });
  await pipeline(Readable.from(buffer), createWriteStream(full, { flags: 'wx', mode: 0o600 }));
  return key;
}

export async function openReceiptFile(key) {
  const full = resolveSafe(key);
  const info = await stat(full);
  return { stream: createReadStream(full), size: info.size };
}

export async function deleteReceiptFile(key) {
  await rm(resolveSafe(key), { force: true });
}

export async function removeUserFiles(userId) {
  await rm(path.join(uploadRoot(), String(userId)), { recursive: true, force: true });
}