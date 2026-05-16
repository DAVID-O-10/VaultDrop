// In-memory store — replace with Redis or a DB (e.g. MongoDB, SQLite) in production
const transfers = new Map();

export const store = {
  /** Save a transfer */
  set(id, data) {
    transfers.set(id, { ...data, id, createdAt: data.createdAt || new Date().toISOString() });
  },

  /** Get a transfer by ID */
  get(id) {
    return transfers.get(id) || null;
  },

  /** Update fields on a transfer */
  update(id, fields) {
    const existing = transfers.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...fields, updatedAt: new Date().toISOString() };
    transfers.set(id, updated);
    return updated;
  },

  /** Delete a transfer */
  delete(id) {
    return transfers.delete(id);
  },

  /** Get all transfers */
  getAll() {
    return Array.from(transfers.values());
  },

  /** Get expired transfers */
  getExpired() {
    const now = new Date();
    return Array.from(transfers.values()).filter((t) => {
      if (!t.expiresAt) return false;
      return new Date(t.expiresAt) < now;
    });
  },
};
