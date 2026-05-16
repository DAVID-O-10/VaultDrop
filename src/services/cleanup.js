import { rm, access } from 'fs/promises';
import { join } from 'path';
import { store } from '../store.js';

/**
 * Delete all files associated with a transfer from disk
 */
export async function deleteTransferFiles(transfer) {
  const uploadDir = process.env.STORAGE_PATH || './uploads';
  const transferDir = join(uploadDir, transfer.id);

  try {
    await access(transferDir);
    await rm(transferDir, { recursive: true, force: true });
    console.log(`[Cleanup] Deleted files for transfer ${transfer.id}`);
  } catch {
    // Directory may already be gone — that's fine
  }
}

/**
 * Scan all transfers and destroy expired or maxed-out ones
 */
export async function cleanupExpiredTransfers() {
  const expired = store.getExpired();
  let count = 0;

  for (const transfer of expired) {
    if (transfer.status !== 'active') continue;
    try {
      await deleteTransferFiles(transfer);
      store.update(transfer.id, { status: 'expired' });
      store.delete(transfer.id);
      count++;
    } catch (err) {
      console.error(`[Cleanup] Error destroying ${transfer.id}:`, err.message);
    }
  }

  if (count > 0) {
    console.log(`[Cleanup] Destroyed ${count} expired transfer(s)`);
  }
}
