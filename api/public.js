// GET /api/public            → daftar campaign yang tampil
// GET /api/public?slug=xxx   → detail campaign + kabar terbaru, pencairan, donatur & doa
import { handler, HttpError, q, PUBLIC_COLS, PUBLIC_LIST_COLS } from './_lib.js';

export default handler(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Metode tidak diizinkan.');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=60');

  const slug = String(req.query.slug || '').trim();
  if (slug) {
    const rows = await q(`SELECT ${PUBLIC_COLS} FROM campaigns WHERE slug = $1 AND visible`, [slug]);
    const c = rows[0];
    if (!c) throw new HttpError(404, 'Campaign tidak ditemukan.');
    const [updates, disbursements, donations] = await Promise.all([
      q(`SELECT id, title, body, image, to_char(posted_at, 'YYYY-MM-DD') AS date
         FROM updates WHERE campaign_id = $1 ORDER BY posted_at DESC, id DESC`, [c.id]),
      q(`SELECT id, amount::float8 AS amount, description, image, to_char(disbursed_at, 'YYYY-MM-DD') AS date
         FROM disbursements WHERE campaign_id = $1 ORDER BY disbursed_at DESC, id DESC`, [c.id]),
      q(`SELECT id, CASE WHEN anonymous OR name = '' THEN 'Hamba Allah' ELSE name END AS name,
           amount::float8 AS amount, donor_count, CASE WHEN show_prayer THEN prayer ELSE '' END AS prayer,
           to_char(donated_at, 'YYYY-MM-DD') AS date
         FROM donations WHERE campaign_id = $1 ORDER BY donated_at DESC, id DESC LIMIT 300`, [c.id])
    ]);
    delete c.id;
    c.updates = updates;
    c.disbursements = disbursements;
    c.donations = donations;
    return res.status(200).json({ ok: true, campaign: c });
  }

  const rows = await q(`SELECT ${PUBLIC_LIST_COLS} FROM campaigns WHERE visible ORDER BY sort ASC, created_at DESC LIMIT 30`);
  res.status(200).json({ ok: true, campaigns: rows });
});
