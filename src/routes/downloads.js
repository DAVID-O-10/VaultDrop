import express from 'express';
import bcrypt from 'bcrypt';
import { createReadStream, statSync } from 'fs';
import { join } from 'path';
import archiver from 'archiver';
import mime from 'mime-types';

import { store } from '../store.js';
import { deleteTransferFiles } from '../services/cleanup.js';

const router = express.Router();

/** Check if a transfer is still valid */
function isExpired(transfer) {
  if (!transfer.expiresAt) return false;
  return new Date(transfer.expiresAt) < new Date();
}

function isMaxedOut(transfer) {
  if (!transfer.maxDownloads) return false;
  return transfer.downloadCount >= transfer.maxDownloads;
}

/**
 * GET /api/download/:id/info
 * Returns portal metadata (no file stream, no password reveal)
 */
router.get('/:id/info', (req, res) => {
  const transfer = store.get(req.params.id);
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found or destroyed' });
  }

  if (transfer.status !== 'active') {
    return res.status(410).json({ error: 'Transfer has been destroyed', status: transfer.status });
  }

  if (isExpired(transfer)) {
    destroyTransfer(transfer, 'expired', req.io);
    return res.status(410).json({ error: 'Transfer has expired', status: 'expired' });
  }

  if (isMaxedOut(transfer)) {
    destroyTransfer(transfer, 'limit_reached', req.io);
    return res.status(410).json({ error: 'Download limit reached', status: 'limit_reached' });
  }

  // Track "opened" event
  const events = transfer.events || [];
  if (!events.find((e) => e.type === 'opened')) {
    const updated = store.update(req.params.id, {
      events: [...events, { type: 'opened', at: new Date().toISOString() }],
    });
    req.io?.to(`transfer:${req.params.id}`).emit('transfer-event', { type: 'opened' });
  }

  return res.json({
    id: transfer.id,
    files: transfer.files.map((f) => ({ name: f.name, size: f.size, mimetype: f.mimetype })),
    totalSize: transfer.totalSize,
    senderName: transfer.senderName,
    recipientName: transfer.recipientName,
    message: transfer.message,
    hasPassword: transfer.hasPassword,
    expiresAt: transfer.expiresAt,
    downloadCount: transfer.downloadCount,
    maxDownloads: transfer.maxDownloads,
    status: transfer.status,
  });
});

/**
 * POST /api/download/:id/verify
 * Verify password
 */
router.post('/:id/verify', async (req, res) => {
  const transfer = store.get(req.params.id);
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });

  if (!transfer.hasPassword) return res.json({ success: true });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const match = await bcrypt.compare(password, transfer.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid password' });

  return res.json({ success: true });
});

/**
 * GET /api/download/:id/file
 * Stream file(s) to recipient
 * Query: ?password=xxx (if protected)
 * If multiple files → zip archive streamed on the fly
 */
router.get('/:id/file', async (req, res) => {
  const transfer = store.get(req.params.id);
  if (!transfer) return res.status(404).json({ error: 'Transfer not found' });

  if (transfer.status !== 'active') {
    return res.status(410).json({ error: 'Transfer destroyed', status: transfer.status });
  }

  if (isExpired(transfer)) {
    destroyTransfer(transfer, 'expired', req.io);
    return res.status(410).json({ error: 'Transfer expired' });
  }

  if (isMaxedOut(transfer)) {
    destroyTransfer(transfer, 'limit_reached', req.io);
    return res.status(410).json({ error: 'Download limit reached' });
  }

  // Password check
  if (transfer.hasPassword) {
    const { password } = req.query;
    if (!password) return res.status(401).json({ error: 'Password required' });
    const match = await bcrypt.compare(password, transfer.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid password' });
  }

  // Increment download count
  const newCount = (transfer.downloadCount || 0) + 1;
  const events = [...(transfer.events || []), { type: 'downloaded', at: new Date().toISOString() }];
  store.update(req.params.id, { downloadCount: newCount, events });

  // Emit to sender dashboard
  req.io?.to(`transfer:${req.params.id}`).emit('transfer-event', {
    type: 'downloaded',
    count: newCount,
  });

  const files = transfer.files;

  // Single file — stream directly
  if (files.length === 1) {
    const file = files[0];
    const mimeType = mime.lookup(file.name) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Content-Length', file.size);

    const stream = createReadStream(file.path);
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('[Download] Stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    });
  } else {
    // Multiple files — stream as zip
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="vaultdrop-${transfer.id.slice(0, 8)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const file of files) {
      archive.file(file.path, { name: file.name });
    }

    archive.finalize();

    archive.on('error', (err) => {
      console.error('[Archive] Error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Archive error' });
    });
  }

  // Auto-destroy after download if configured
  res.on('finish', async () => {
    const updated = store.get(req.params.id);
    if (!updated) return;

    const shouldDestroy =
      updated.autoDestroy ||
      (updated.maxDownloads && updated.downloadCount >= updated.maxDownloads);

    if (shouldDestroy) {
      await destroyTransfer(updated, 'completed', req.io);
    }
  });
});

/** Internal: mark destroyed and delete files */
async function destroyTransfer(transfer, reason, io) {
  await deleteTransferFiles(transfer);
  store.update(transfer.id, { status: 'destroyed', destroyReason: reason });
  store.delete(transfer.id);

  io?.to(`transfer:${transfer.id}`).emit('transfer-destroyed', { reason });
}

export default router;
