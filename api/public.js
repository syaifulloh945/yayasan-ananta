// GET  /api/public                 → daftar campaign yang tampil
// GET  /api/public?slug=xxx        → detail campaign + kabar terbaru, pencairan, donatur & doa (yang sudah diterima)
// POST /api/public?action=donate   → donatur menekan "Konfirmasi via WhatsApp": data disimpan sebagai MENUNGGU verifikasi admin
import {
  handler, HttpError, q, body, requirePost, clientIp, checkLimit, hitLimit,
  PUBLIC_COLS, PUBLIC_LIST_COLS
} from './_lib.js';

export default handler(async (req, res) => {
  if (req.method === 'POST' && String(req.query.action || '') === 'donate') {
    requirePost(req);
    const b = body(req);
    const key = `donate-ip:${clientIp(req)}`;
    await checkLimit(key, 15);
    const rows = await q('SELECT id FROM campaigns WHERE slug = $1 AND visible', [String(b.slug || '').trim()]);
    if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
    const anonymous = !!b.anonymous;
    const name = anonymous ? '' : String(b.name || '').trim().slice(0, 80);
    if (!anonymous && !name) throw new HttpError(400, 'Nama donatur kosong.');
    const amount = Math.round(Number(b.amount) || 0);
    if (amount < 10000 || amount > 1e10) throw new HttpError(400, 'Nominal tidak valid.');
    const prayer = String(b.prayer || '').trim().slice(0, 1000);
    const method = String(b.method || '').trim().slice(0, 60);
    const pending = await q(`SELECT count(*)::int AS n FROM donations WHERE campaign_id = $1 AND status = 'pending'`, [rows[0].id]);
    if (pending[0].n >= 500) throw new HttpError(429, 'Terlalu banyak donasi menunggu verifikasi.');
    await q(`INSERT INTO donations (campaign_id, name, anonymous, amount, donor_count, prayer, show_prayer, donated_at, status, source, method)
             VALUES ($1, $2, $3, $4, 1, $5, true, (now() AT TIME ZONE 'Asia/Jakarta')::date, 'pending', 'web', $6)`,
      [rows[0].id, name, anonymous, amount, prayer, method]);
    await hitLimit(key, 60);
    return res.status(200).json({ ok: true });
  }

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
         FROM donations WHERE campaign_id = $1 AND status = 'approved' ORDER BY donated_at DESC, id DESC LIMIT 300`, [c.id])
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
