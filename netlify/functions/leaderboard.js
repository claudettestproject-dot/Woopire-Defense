// Global leaderboard for Woopire Defense — Netlify Functions v2 + Netlify Blobs.
// GET  /api/leaderboard -> { entries: [...] } (top players by level, then exp)
// POST /api/leaderboard -> upsert the calling player's entry (one entry per playerId)
// There is no login, so scores are informal/unverified. Input is validated and clamped,
// but this is not anti-cheat.
import { getStore } from '@netlify/blobs';

export const config = { path: '/api/leaderboard' };

const STORE_NAME = 'leaderboard';
const BOARD_KEY = 'board';
const MAX_ENTRIES = 200;     // stored
const RETURN_ENTRIES = 100;  // sent to clients
const MAX_EQUIPPED = 6;
const MAX_BODY_BYTES = 4096;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UNIT_RE = /^[A-Za-z0-9_-]{1,64}$/;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

const num = (v, min, max, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

function sanitize(p) {
  if (!p || typeof p !== 'object' || !ID_RE.test(String(p.playerId || ''))) return null;
  const equipped = Array.isArray(p.equipped)
    ? p.equipped.filter((u) => typeof u === 'string' && UNIT_RE.test(u)).slice(0, MAX_EQUIPPED)
    : [];
  const base = typeof p.equippedBase === 'string' && UNIT_RE.test(p.equippedBase) ? p.equippedBase : null;
  return {
    id: p.playerId,
    name: String(p.name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20),
    level: num(p.level, 1, 9999, 1),
    exp: num(p.exp, 0, 1e12),
    equipped,
    equippedBase: base,
    playtimeMs: num(p.playtimeMs, 0, 1e11),
    gems: num(p.gems, 0, 1e15),
    stagesCleared: num(p.stagesCleared, 0, 10000),
    stagesPossible: num(p.stagesPossible, 0, 10000),
    updatedAt: Date.now(),
  };
}

const byRank = (a, b) => b.level - a.level || b.exp - a.exp || a.updatedAt - b.updatedAt;

export default async (req) => {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });

  if (req.method === 'GET') {
    const board = (await store.get(BOARD_KEY, { type: 'json' })) || [];
    return json({ entries: board.slice(0, RETURN_ENTRIES) }, 200, {
      'Cache-Control': 'public, max-age=5',
    });
  }

  if (req.method === 'POST') {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413);
    let payload;
    try { payload = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400); }
    const entry = sanitize(payload);
    if (!entry) return json({ error: 'invalid payload' }, 400);

    const board = (await store.get(BOARD_KEY, { type: 'json' })) || [];
    const i = board.findIndex((e) => e.id === entry.id);
    if (i >= 0) board[i] = entry; else board.push(entry);
    board.sort(byRank);
    await store.setJSON(BOARD_KEY, board.slice(0, MAX_ENTRIES));
    return json({ ok: true, rank: board.findIndex((e) => e.id === entry.id) + 1 });
  }

  return json({ error: 'method not allowed' }, 405, { Allow: 'GET, POST' });
};
