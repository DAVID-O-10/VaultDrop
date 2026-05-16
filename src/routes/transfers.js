import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import QRCode from 'qrcode';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

import { store } from '../store.js';
import { sendTransferEmail } from '../services/email.js';
import { deleteTransferFiles } from '../services/cleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Multer storage — files go into uploads/<transferId>/
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const transferId = req.transferId || (req.transferId = uuidv4());
    const dir = join(process.env.STORAGE_PATH || './uploads', transferId);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB per file
});

/**
 * POST /api/transfers
 * Create a new transfer (upload files + metadata)
 */
router.post('/', upload.array('files', 50), async (req, res) => {
  try {
    const transferId = req.transferId || uuidv4();
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const {
      recipientEmail,
      recipientName,
      senderName,
      message,
      password,
      expiresIn,       // hours: '1','6','24','72','168' or 'never'
      downloadLimit,   // number or 'unlimited'
      oneTimeDownload, // 'true'/'false'
      autoDestroy,     // 'true'/'false'
    } = req.body;

    if (!recipientEmail) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }

    // Hash password if provided
    let passwordHash = null;
    if (password && password.trim()) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // Calculate expiry
    let expiresAt = null;
    if (expiresIn && expiresIn !== 'never') {
      const hours = parseInt(expiresIn, 10);
      expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    }

    const maxDownloads =
      oneTimeDownload === 'true' ? 1
      : downloadLimit && downloadLimit !== 'unlimited'
      ? parseInt(downloadLimit, 10)
      : null;

    // Build file metadata
    const fileList = files.map((f) => ({
      name: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
      path: f.path,
    }));

    const totalSize = fileList.reduce((acc, f) => acc + f.size, 0);

    // Generate portal URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const portalUrl = `${frontendUrl}/portal/${transferId}`;

    // Generate QR code (base64 PNG)
    const qrCode = await QRCode.toDataURL(portalUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#0f0f0f', light: '#ffffff' },
    });

    // Persist transfer
    const transfer = {
      id: transferId,
      files: fileList,
      totalSize,
      recipientEmail,
      recipientName: recipientName || '',
      senderName: senderName || 'Someone',
      message: message || '',
      passwordHash,
      hasPassword: !!passwordHash,
      expiresAt,
      maxDownloads,
      downloadCount: 0,
      autoDestroy: autoDestroy === 'true',
      status: 'active',
      portalUrl,
      qrCode,
      events: [],
    };

    store.set(transferId, transfer);

    // Send notification email (non-blocking)
    sendTransferEmail(transfer).catch((err) =>
      console.error('[Email] Failed to send:', err.message)
    );

    return res.status(201).json({
      transferId,
      portalUrl,
      qrCode,
      expiresAt,
      fileCount: files.length,
      totalSize,
    });
  } catch (err) {
    console.error('[Transfer] Create error:', err);
    return res.status(500).json({ error: 'Failed to create transfer', detail: err.message });
  }
});

/**
 * GET /api/transfers/:id/status
 * Sender polls for delivery status
 */
router.get('/:id/status', (req, res) => {
  const transfer = store.get(req.params.id);
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found' });
  }

  return res.json({
    id: transfer.id,
    status: transfer.status,
    downloadCount: transfer.downloadCount,
    maxDownloads: transfer.maxDownloads,
    expiresAt: transfer.expiresAt,
    events: transfer.events,
    fileCount: transfer.files.length,
    totalSize: transfer.totalSize,
    recipientEmail: transfer.recipientEmail,
  });
});

/**
 * DELETE /api/transfers/:id
 * Sender manually revokes a transfer
 */
router.delete('/:id', async (req, res) => {
  const transfer = store.get(req.params.id);
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found' });
  }

  await deleteTransferFiles(transfer);
  store.update(req.params.id, { status: 'revoked' });
  store.delete(req.params.id);

  // Notify connected clients
  req.io.to(`transfer:${req.params.id}`).emit('transfer-destroyed', {
    reason: 'revoked',
  });

  return res.json({ success: true, message: 'Transfer revoked' });
});

export default router;
