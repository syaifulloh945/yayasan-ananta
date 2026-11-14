// GET /api/public            → daftar campaign yang tampil
// GET /api/public?slug=xxx   → detail satu campaign yang tampil
import { handler, HttpError, q, PUBLIC_COLS } from './_lib.js';

export default handler(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Metode tidak diizinkan.');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=60');

  const slug = String(req.query.slug || '').trim();
  if (slug) {
    const rows = await q(`SELECT ${PUBLIC_COLS} FROM campaigns WHERE slug = $1 AND visible`, [slug]);
    if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
    return res.status(200).json({ ok: true, campaign: rows[0] });
  }

  const rows = await q(`SELECT ${PUBLIC_COLS} FROM campaigns WHERE visible ORDER BY sort ASC, created_at DESC LIMIT 30`);
  res.status(200).json({ ok: true, campaigns: rows });
});
