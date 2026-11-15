// Endpoint khusus admin (wajib login). Semua aksi lewat ?action=...
//
// GET  stats | campaigns | campaign&id= | admins
// POST campaign-save | campaign-toggle | campaign-delete | upload
//      donation-save | donation-delete | update-save | update-delete | disb-save | disb-delete
//      admin-create | admin-reset | admin-delete | change-password | new-recovery
import crypto from 'node:crypto';
import { put, del } from '@vercel/blob';
import {
  handler, HttpError, q, body, requirePost, requireAdmin,
  CAMPAIGN_COLS, cleanCampaign, uniqueSlug, isBlobUrl, imagesInHtml, recomputeTotals,
  cleanDate, cleanMoney, cleanOptionalImage,
  hashSecret, verifySecret, newRecoveryCode, newTempPassword, checkPasswordStrength,
  makeSessionCookie
} from './_lib.js';

async function deleteBlobs(urls) {
  const list = [...new Set((urls || []).filter(isBlobUrl))];
  if (!list.length) return;
  try { await del(list); } catch (e) { console.error('Gagal menghapus foto:', e && e.message); }
}
const campaignImages = (c) => [...(c.images || []), ...imagesInHtml(c.story_html)];

async function campaignExtras(id) {
  const [donations, updates, disbursements] = await Promise.all([
    q(`SELECT id, name, anonymous, amount::float8 AS amount, donor_count, prayer, show_prayer,
         to_char(donated_at, 'YYYY-MM-DD') AS date FROM donations WHERE campaign_id = $1 ORDER BY donated_at DESC, id DESC`, [id]),
    q(`SELECT id, title, body, image, to_char(posted_at, 'YYYY-MM-DD') AS date FROM updates
       WHERE campaign_id = $1 ORDER BY posted_at DESC, id DESC`, [id]),
    q(`SELECT id, amount::float8 AS amount, description, image, to_char(disbursed_at, 'YYYY-MM-DD') AS date
       FROM disbursements WHERE campaign_id = $1 ORDER BY disbursed_at DESC, id DESC`, [id])
  ]);
  return { donations, updates, disbursements };
}
async function campaignWithExtras(id) {
  const rows = await q(`SELECT ${CAMPAIGN_COLS} FROM campaigns WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
  return Object.assign(rows[0], await campaignExtras(id));
}
async function requireCampaign(id) {
  const rows = await q('SELECT id FROM campaigns WHERE id = $1', [Number(id) || 0]);
  if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
  return rows[0].id;
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
      return res.status(200).json({ ok: true, campaign: await campaignWithExtras(Number(req.query.id) || 0) });
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

  /* ----- campaign ----- */
  if (action === 'campaign-save') {
    const c = cleanCampaign(b);
    const id = Number(b.id) || 0;
    if (id) {
      const old = await q('SELECT title, slug, images, story_html FROM campaigns WHERE id = $1', [id]);
      if (!old[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
      const slug = old[0].title === c.title ? old[0].slug : await uniqueSlug(c.title, id);
      await q(`UPDATE campaigns SET slug=$1, title=$2, category=$3, summary=$4, story=$5, story_html=$6, target=$7,
          deadline=$8, images=$9::jsonb, visible=$10, sort=$11, updated_at=now() WHERE id=$12`,
        [slug, c.title, c.category, c.summary, c.story, c.story_html, c.target, c.deadline,
          JSON.stringify(c.images), c.visible, c.sort, id]);
      const keep = new Set(campaignImages(c));
      await deleteBlobs(campaignImages(old[0]).filter((u) => !keep.has(u)));
      return res.status(200).json({ ok: true, campaign: await campaignWithExtras(id) });
    }
    const slug = await uniqueSlug(c.title);
    const rows = await q(`INSERT INTO campaigns (slug, title, category, summary, story, story_html, target, deadline, images, visible, sort)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING id`,
      [slug, c.title, c.category, c.summary, c.story, c.story_html, c.target, c.deadline,
        JSON.stringify(c.images), c.visible, c.sort]);
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(rows[0].id) });
  }

  if (action === 'campaign-toggle') {
    const rows = await q(`UPDATE campaigns SET visible = $1, updated_at = now() WHERE id = $2 RETURNING id`, [!!b.visible, Number(b.id) || 0]);
    if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
    return res.status(200).json({ ok: true });
  }

  if (action === 'campaign-delete') {
    const id = Number(b.id) || 0;
    const extra = await q(`SELECT image FROM updates WHERE campaign_id = $1 UNION ALL SELECT image FROM disbursements WHERE campaign_id = $1`, [id]);
    const rows = await q('DELETE FROM campaigns WHERE id = $1 RETURNING images, story_html', [id]);
    if (!rows[0]) throw new HttpError(404, 'Campaign tidak ditemukan.');
    await deleteBlobs([...campaignImages(rows[0]), ...extra.map((r) => r.image)]);
    return res.status(200).json({ ok: true });
  }

  /* ----- catatan donasi ----- */
  if (action === 'donation-save') {
    const cid = await requireCampaign(b.campaign_id);
    const anonymous = !!b.anonymous;
    const name = String(b.name || '').trim().slice(0, 80);
    if (!anonymous && !name) throw new HttpError(400, 'Isi nama donatur atau centang Hamba Allah.');
    const amount = cleanMoney(b.amount, 'Nominal', 1);
    const donorCount = Math.max(1, Math.min(1e6, Math.round(Number(b.donor_count) || 1)));
    const prayer = String(b.prayer || '').trim().slice(0, 1000);
    const date = cleanDate(b.date, 'Tanggal');
    const id = Number(b.id) || 0;
    if (id) {
      const r = await q(`UPDATE donations SET name=$1, anonymous=$2, amount=$3, donor_count=$4, prayer=$5, show_prayer=$6, donated_at=$7
                         WHERE id=$8 AND campaign_id=$9 RETURNING id`, [name, anonymous, amount, donorCount, prayer, b.show_prayer !== false, date, id, cid]);
      if (!r[0]) throw new HttpError(404, 'Catatan donasi tidak ditemukan.');
    } else {
      await q(`INSERT INTO donations (campaign_id, name, anonymous, amount, donor_count, prayer, show_prayer, donated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [cid, name, anonymous, amount, donorCount, prayer, b.show_prayer !== false, date]);
    }
    await recomputeTotals(cid);
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(cid) });
  }
  if (action === 'donation-delete') {
    const r = await q('DELETE FROM donations WHERE id = $1 RETURNING campaign_id', [Number(b.id) || 0]);
    if (!r[0]) throw new HttpError(404, 'Catatan donasi tidak ditemukan.');
    await recomputeTotals(r[0].campaign_id);
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(r[0].campaign_id) });
  }

  /* ----- kabar terbaru ----- */
  if (action === 'update-save') {
    const cid = await requireCampaign(b.campaign_id);
    const title = String(b.title || '').trim().slice(0, 150);
    const text = String(b.body || '').trim().slice(0, 10000);
    if (!title) throw new HttpError(400, 'Isi judul kabar.');
    if (!text) throw new HttpError(400, 'Isi kabar tidak boleh kosong.');
    const image = cleanOptionalImage(b.image);
    const date = cleanDate(b.date, 'Tanggal');
    const id = Number(b.id) || 0;
    if (id) {
      const old = await q('SELECT image FROM updates WHERE id=$1 AND campaign_id=$2', [id, cid]);
      if (!old[0]) throw new HttpError(404, 'Kabar tidak ditemukan.');
      await q('UPDATE updates SET title=$1, body=$2, image=$3, posted_at=$4 WHERE id=$5', [title, text, image, date, id]);
      if (old[0].image !== image) await deleteBlobs([old[0].image]);
    } else {
      await q('INSERT INTO updates (campaign_id, title, body, image, posted_at) VALUES ($1,$2,$3,$4,$5)', [cid, title, text, image, date]);
    }
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(cid) });
  }
  if (action === 'update-delete') {
    const r = await q('DELETE FROM updates WHERE id = $1 RETURNING campaign_id, image', [Number(b.id) || 0]);
    if (!r[0]) throw new HttpError(404, 'Kabar tidak ditemukan.');
    await deleteBlobs([r[0].image]);
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(r[0].campaign_id) });
  }

  /* ----- pencairan dana ----- */
  if (action === 'disb-save') {
    const cid = await requireCampaign(b.campaign_id);
    const amount = cleanMoney(b.amount, 'Nominal pencairan', 1);
    const description = String(b.description || '').trim().slice(0, 3000);
    if (!description) throw new HttpError(400, 'Isi keterangan pencairan.');
    const image = cleanOptionalImage(b.image);
    const date = cleanDate(b.date, 'Tanggal');
    const id = Number(b.id) || 0;
    if (id) {
      const old = await q('SELECT image FROM disbursements WHERE id=$1 AND campaign_id=$2', [id, cid]);
      if (!old[0]) throw new HttpError(404, 'Data pencairan tidak ditemukan.');
      await q('UPDATE disbursements SET amount=$1, description=$2, image=$3, disbursed_at=$4 WHERE id=$5', [amount, description, image, date, id]);
      if (old[0].image !== image) await deleteBlobs([old[0].image]);
    } else {
      await q('INSERT INTO disbursements (campaign_id, amount, description, image, disbursed_at) VALUES ($1,$2,$3,$4,$5)', [cid, amount, description, image, date]);
    }
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(cid) });
  }
  if (action === 'disb-delete') {
    const r = await q('DELETE FROM disbursements WHERE id = $1 RETURNING campaign_id, image', [Number(b.id) || 0]);
    if (!r[0]) throw new HttpError(404, 'Data pencairan tidak ditemukan.');
    await deleteBlobs([r[0].image]);
    return res.status(200).json({ ok: true, campaign: await campaignWithExtras(r[0].campaign_id) });
  }

  /* ----- admin ----- */
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
