import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

dotenv.config();

import transferRoutes from './routes/transfers.js';
import downloadRoutes from './routes/downloads.js';
import { cleanupExpiredTransfers } from './services/cleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Ensure upload dir exists
const uploadDir = process.env.STORAGE_PATH || './uploads';
mkdirSync(uploadDir, { recursive: true });

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach socket.io to req
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/transfers', transferRoutes);
app.use('/api/download', downloadRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-transfer', (transferId) => {
    socket.join(`transfer:${transferId}`);
    console.log(`Socket ${socket.id} joined transfer:${transferId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Cleanup cron — runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Cron] Running cleanup of expired transfers...');
  await cleanupExpiredTransfers();
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🔒 VaultDrop Backend running on http://localhost:${PORT}`);
  console.log(`📦 Storage: ${process.env.STORAGE_TYPE || 'local'} (${uploadDir})\n`);
});
