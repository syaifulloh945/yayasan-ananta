// Endpoint khusus admin (wajib login). Semua aksi lewat ?action=...
//
// GET  stats | campaigns | campaign&id= | admins
// POST campaign-save | campaign-toggle | campaign-delete | upload
//      admin-create | admin-reset | admin-delete | change-password | new-recovery
import crypto from 'node:crypto';
import { put, del } from '@vercel/blob';
import {
  handler, HttpError, q, body, requirePost, requireAdmin,
  CAMPAIGN_COLS, cleanCampaign, uniqueSlug, isBlobUrl,
  hashSecret, verifySecret, newRecoveryCode, newTempPassword, checkPasswordStrength,
  makeSessionCookie
} from './_lib.js';

async function deleteBlobs(urls) {
  const list = (urls || []).filter(isBlobUrl);
  if (!list.length) return;
  try { await del(list); } catch (e) { console.error('Gagal menghapus foto:', e && e.message); }
}

export default handler(async (req, res) => {
  const me = await requireAdmin(req);
  const action = String(req.query.action || '');

  /* ---------- GET ---------- */
  if (req.method === 'GET') {
    if (action === 'stats') {
      const rows = await q(`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE visible)::int AS visible,
          coalesce(sum(target), 0)::float8 AS target,
          coalesce(sum(collected), 0)::float8 AS collected,
          coalesce(sum(donors), 0)::int AS donors
        FROM campaigns`);
      return res.status(200).json({ ok: true, stats: rows[0], me: { id: me.id, username: me.username, name: me.name } });
    }
    if (action === 'campaigns') {
      const rows = await q(`SELECT ${CAMPAIGN_COLS} FROM campaigns ORDER BY sort ASC, created_at DESC`);
      return res.status(200).json({ ok: true, campaigns: rows });
    }
    if (action === 'campaign') {
      const rows = await q(`SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = $1`, [Number(req.query.id) || 0]);
      if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
      return res.status(200).json({ ok: true, campaign: rows[0] });
    }
    if (action === 'admins') {
      const rows = await q('SELECT id, username, name, created_at, last_login FROM admins ORDER BY id');
      return res.status(200).json({ ok: true, admins: rows, meId: me.id });
    }
    throw new HttpError(404, 'Aksi tidak dikenal.');
  }

  /* ---------- POST ---------- */
  requirePost(req);
  const b = body(req);

  if (action === 'upload') {
    const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
    if (!m) throw new HttpError(400, 'Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) throw new HttpError(400, 'Foto kosong.');
    if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, 'Ukuran foto terlalu besar (maksimal 3 MB).');
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[m[1]];
    const name = `campaign/${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
    const blob = await put(name, buf, { access: 'public', contentType: m[1], addRandomSuffix: false, cacheControlMaxAge: 31536000 });
    return res.status(200).json({ ok: true, url: blob.url });
  }

  if (action === 'campaign-save') {
    const c = cleanCampaign(b);
    const id = Number(b.id) || 0;
    if (id) {
      const old = await q('SELECT title, slug, images FROM campaigns WHERE id = $1', [id]);
      if (!old[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
      const slug = old[0].title === c.title ? old[0].slug : await uniqueSlug(c.title, id);
      const rows = await q(`UPDATE campaigns SET slug=$1, title=$2, category=$3, summary=$4, story=$5, target=$6, collected=$7,
          donors=$8, deadline=$9, images=$10::jsonb, visible=$11, sort=$12, updated_at=now()
        WHERE id=$13 RETURNING ${CAMPAIGN_COLS}`,
        [slug, c.title, c.category, c.summary, c.story, c.target, c.collected, c.donors, c.deadline,
          JSON.stringify(c.images), c.visible, c.sort, id]);
      const removed = (old[0].images || []).filter((u) => !c.images.includes(u));
      await deleteBlobs(removed);
      return res.status(200).json({ ok: true, campaign: rows[0] });
    }
    const slug = await uniqueSlug(c.title);
    const rows = await q(`INSERT INTO campaigns (slug, title, category, summary, story, target, collected, donors, deadline, images, visible, sort)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING ${CAMPAIGN_COLS}`,
      [slug, c.title, c.category, c.summary, c.story, c.target, c.collected, c.donors, c.deadline,
        JSON.stringify(c.images), c.visible, c.sort]);
    return res.status(200).json({ ok: true, campaign: rows[0] });
  }

  if (action === 'campaign-toggle') {
    const rows = await q(`UPDATE campaigns SET visible = $1, updated_at = now() WHERE id = $2 RETURNING ${CAMPAIGN_COLS}`,
      [!!b.visible, Number(b.id) || 0]);
    if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
    return res.status(200).json({ ok: true, campaign: rows[0] });
  }

  if (action === 'campaign-delete') {
    const rows = await q('DELETE FROM campaigns WHERE id = $1 RETURNING images', [Number(b.id) || 0]);
    if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
    await deleteBlobs(rows[0].images);
    return res.status(200).json({ ok: true });
  }

  if (action === 'admin-create') {
    const username = String(b.username || '').trim().toLowerCase();
    const name = String(b.name || '').trim().slice(0, 80);
    if (!/^[a-z0-9._-]{4,32}$/.test(username)) throw new HttpError(400, 'Username 4–32 karakter: huruf kecil, angka, titik, strip, atau garis bawah.');
    checkPasswordStrength(b.password);
    const exists = await q('SELECT 1 FROM admins WHERE lower(username) = $1', [username]);
    if (exists[0]) throw new HttpError(409, 'Username sudah dipakai.');
    const rec = newRecoveryCode();
    await q('INSERT INTO admins (username, name, pass_hash, recovery_hash) VALUES ($1,$2,$3,$4)',
      [username, name || username, hashSecret(b.password), rec.hash]);
    return res.status(200).json({ ok: true, recoveryCode: rec.plain });
  }

  if (action === 'admin-reset') {
    const id = Number(b.id) || 0;
    if (id === me.id) throw new HttpError(400, 'Untuk akun sendiri, gunakan menu Akun Saya.');
    const temp = newTempPassword();
    const rec = newRecoveryCode();
    const rows = await q('UPDATE admins SET pass_hash=$1, recovery_hash=$2, pass_ver = pass_ver + 1 WHERE id=$3 RETURNING username',
      [hashSecret(temp), rec.hash, id]);
    if (!rows[0]) throw new HttpError(404, 'Admin tidak ditemukan.');
    return res.status(200).json({ ok: true, username: rows[0].username, password: temp, recoveryCode: rec.plain });
  }

  if (action === 'admin-delete') {
    const id = Number(b.id) || 0;
    if (id === me.id) throw new HttpError(400, 'Tidak bisa menghapus akun sendiri.');
    const count = await q('SELECT count(*)::int AS n FROM admins');
    if (count[0].n <= 1) throw new HttpError(400, 'Minimal harus ada satu admin.');
    const rows = await q('DELETE FROM admins WHERE id = $1 RETURNING id', [id]);
    if (!rows[0]) throw new HttpError(404, 'Admin tidak ditemukan.');
    return res.status(200).json({ ok: true });
  }

  if (action === 'change-password' || action === 'new-recovery') {
    const rows = await q('SELECT id, pass_hash, pass_ver FROM admins WHERE id = $1', [me.id]);
    if (!rows[0] || !verifySecret(String(b.current || ''), rows[0].pass_hash)) {
      throw new HttpError(400, 'Password saat ini salah.');
    }
    if (action === 'change-password') {
      checkPasswordStrength(b.newPassword);
      const upd = await q('UPDATE admins SET pass_hash = $1, pass_ver = pass_ver + 1 WHERE id = $2 RETURNING id, pass_ver',
        [hashSecret(b.newPassword), me.id]);
      res.setHeader('Set-Cookie', makeSessionCookie(upd[0]));
      return res.status(200).json({ ok: true });
    }
    const rec = newRecoveryCode();
    await q('UPDATE admins SET recovery_hash = $1 WHERE id = $2', [rec.hash, me.id]);
    return res.status(200).json({ ok: true, recoveryCode: rec.plain });
  }

  throw new HttpError(404, 'Aksi tidak dikenal.');
});
