// Pustaka bersama untuk API website Yayasan Ananta Karuna Bahagia.
// File berawalan "_" tidak dijadikan endpoint oleh Vercel.
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import { SEED_CAMPAIGNS } from './_seed.js';
import { RAFKA_SLUG, RAFKA_STORY_HTML } from './_rafka_story.js';

/* ---------------- Error & respons ---------------- */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      await ensureSchema();
      await fn(req, res);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      if (status >= 500) console.error(e);
      res.status(status).json({
        ok: false,
        error: e && e.status ? e.message : 'Terjadi kesalahan server. ' + (e && e.message ? e.message : '')
      });
    }
  };
}

export function body(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { throw new HttpError(400, 'Data tidak valid.'); } }
  return b;
}

// Perlindungan CSRF sederhana: semua POST wajib membawa header khusus + JSON.
export function requirePost(req) {
  if (req.method !== 'POST') throw new HttpError(405, 'Metode tidak diizinkan.');
  if (req.headers['x-akb'] !== '1') throw new HttpError(403, 'Permintaan ditolak.');
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('application/json')) throw new HttpError(415, 'Format permintaan tidak didukung.');
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
}

/* ---------------- Database ---------------- */
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || '';
let _sql = null;
export async function q(text, params = []) {
  if (!DB_URL) throw new HttpError(500, 'Database belum terhubung (DATABASE_URL kosong).');
  if (!_sql) _sql = neon(DB_URL);
  return _sql.query(text, params);
}

// Akun admin awal (dibuat otomatis HANYA jika belum ada admin sama sekali).
// Yang disimpan hanyalah hash PBKDF2, bukan password asli.
const SEED_ADMIN = {
  username: 'adminananta',
  name: 'Admin Yayasan',
  passHash: 'pbkdf2$210000$uEyOPFJowRu9FZ98bABY0w==$Ld3jPT4XGp5ZskwhVbqNJ0w++xwSLl9rvkajVi03fLQ=',
  recoveryHash: 'pbkdf2$210000$8+Mc1ZaH9ZZvuH+r+0M8+Q==$srtDWXpZrRK8i0iWbPFKuNpGKcAc0De3H6Z/bocPCck='
};

let schemaReady = null;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await q(`CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        pass_hash TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        pass_ver INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login TIMESTAMPTZ
      )`);
      await q(`CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Umum',
        summary TEXT NOT NULL DEFAULT '',
        story TEXT NOT NULL DEFAULT '',
        target BIGINT NOT NULL DEFAULT 0,
        collected BIGINT NOT NULL DEFAULT 0,
        donors INTEGER NOT NULL DEFAULT 0,
        deadline DATE,
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        visible BOOLEAN NOT NULL DEFAULT false,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q(`CREATE TABLE IF NOT EXISTS attempts (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL
      )`);
      await q(`INSERT INTO admins (username, name, pass_hash, recovery_hash)
               SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM admins)`,
        [SEED_ADMIN.username, SEED_ADMIN.name, SEED_ADMIN.passHash, SEED_ADMIN.recoveryHash]);
      // Versi 2: cerita berformat, catatan donasi, kabar terbaru, pencairan.
      await q(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS story_html TEXT NOT NULL DEFAULT ''`);
      await q(`CREATE TABLE IF NOT EXISTS donations (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        anonymous BOOLEAN NOT NULL DEFAULT false,
        amount BIGINT NOT NULL DEFAULT 0,
        donor_count INTEGER NOT NULL DEFAULT 1,
        prayer TEXT NOT NULL DEFAULT '',
        show_prayer BOOLEAN NOT NULL DEFAULT true,
        donated_at DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      // Versi 3: donasi dari website masuk sebagai "pending" sampai admin menekan Terima.
      await q(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`);
      await q(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin'`);
      await q(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT ''`);
      await q(`CREATE TABLE IF NOT EXISTS updates (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        posted_at DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q(`CREATE TABLE IF NOT EXISTS disbursements (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        amount BIGINT NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        disbursed_at DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await q(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      // Pindahkan angka terkumpul lama (diisi manual) menjadi satu catatan donasi gabungan, sekali saja.
      const mig = await q(`INSERT INTO meta (key) VALUES ('migrate-donations-v1') ON CONFLICT (key) DO NOTHING RETURNING key`);
      if (mig[0]) {
        await q(`INSERT INTO donations (campaign_id, name, amount, donor_count, show_prayer)
                 SELECT c.id, 'Donasi sebelumnya (gabungan)', c.collected, GREATEST(c.donors, 0), false
                 FROM campaigns c WHERE c.collected > 0 AND NOT EXISTS (SELECT 1 FROM donations d WHERE d.campaign_id = c.id)`);
      }
      for (const s of SEED_CAMPAIGNS) {
        const fresh = await q('INSERT INTO meta (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key', ['seed-campaign:' + s.slug]);
        if (!fresh[0]) continue;
        await q(`INSERT INTO campaigns (slug, title, category, summary, story, target, collected, donors, deadline, images, visible, sort)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) ON CONFLICT (slug) DO NOTHING`,
          [s.slug, s.title, s.category, s.summary, s.story, s.target, s.collected, s.donors, s.deadline,
            JSON.stringify(s.images), s.visible, s.sort]);
      }
      // Cerita Rafka hasil impor Word (sekali saja).
      const rk = await q(`INSERT INTO meta (key) VALUES ('rafka-story-v3') ON CONFLICT (key) DO NOTHING RETURNING key`);
      if (rk[0]) {
        const html = sanitizeStory(RAFKA_STORY_HTML);
        await q('UPDATE campaigns SET story_html = $1, story = $2, updated_at = now() WHERE slug = $3', [html, htmlToText(html), RAFKA_SLUG]);
      }
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/* ---------------- Password & kode pemulihan ---------------- */
const ITER = 210000;
export function hashSecret(s) {
  const salt = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(String(s), salt, ITER, 32, 'sha256');
  return `pbkdf2$${ITER}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifySecret(s, stored) {
  try {
    const [alg, it, saltB, hB] = String(stored).split('$');
    if (alg !== 'pbkdf2') return false;
    const ref = Buffer.from(hB, 'base64');
    const h = crypto.pbkdf2Sync(String(s), Buffer.from(saltB, 'base64'), Number(it), ref.length, 'sha256');
    return ref.length === h.length && crypto.timingSafeEqual(h, ref);
  } catch { return false; }
}

const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomFrom(alpha, n) {
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += alpha[bytes[i] % alpha.length];
  return s;
}
// Kode pemulihan baru: { plain: 'AKB-XXXX-XXXX-XXXX', hash }
export function newRecoveryCode() {
  const raw = randomFrom(CODE_ALPHA, 12);
  return { plain: `AKB-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`, hash: hashSecret(raw) };
}
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^AKB(?=.{12}$)/, '');
}
export function newTempPassword() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return `${randomFrom(a, 5)}-${randomFrom(a, 5)}-${randomFrom(a, 4)}`;
}
export function checkPasswordStrength(p) {
  p = String(p || '');
  if (p.length < 8) throw new HttpError(400, 'Password minimal 8 karakter.');
  if (p.length > 128) throw new HttpError(400, 'Password terlalu panjang.');
}
// Kunci Darurat opsional dari Vercel → Settings → Environment Variables (ADMIN_EMERGENCY_KEY).
export function matchesEmergencyKey(input) {
  const key = process.env.ADMIN_EMERGENCY_KEY || '';
  if (key.length < 12 || !input) return false;
  const a = crypto.createHash('sha256').update(String(input).trim()).digest();
  const b = crypto.createHash('sha256').update(key.trim()).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------------- Sesi login (cookie bertanda tangan) ---------------- */
const SESSION_SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('akb-session|' + DB_URL).digest('hex');
const COOKIE = 'akb_s';
const SESSION_DAYS = 7;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(data) { return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url'); }

export function makeSessionCookie(admin) {
  const payload = b64u(JSON.stringify({ u: admin.id, v: admin.pass_ver, e: Date.now() + SESSION_DAYS * 864e5 }));
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}
export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
export async function currentAdmin(req) {
  const token = readCookie(req, COOKIE);
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || !data.u || !data.e || data.e < Date.now()) return null;
  const rows = await q('SELECT id, username, name, pass_ver FROM admins WHERE id = $1', [data.u]);
  const a = rows[0];
  if (!a || a.pass_ver !== data.v) return null;
  return a;
}
export async function requireAdmin(req) {
  const a = await currentAdmin(req);
  if (!a) throw new HttpError(401, 'Sesi berakhir. Silakan login kembali.');
  return a;
}

/* ---------------- Pembatas percobaan (anti tebak password) ---------------- */
export async function checkLimit(key, max) {
  const rows = await q('SELECT count, reset_at > now() AS active FROM attempts WHERE key = $1', [key]);
  if (rows[0] && rows[0].active && rows[0].count >= max) {
    throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
  }
}
export async function hitLimit(key, minutes = 15) {
  await q(`INSERT INTO attempts (key, count, reset_at) VALUES ($1, 1, now() + make_interval(mins => $2::int))
           ON CONFLICT (key) DO UPDATE SET
             count = CASE WHEN attempts.reset_at > now() THEN attempts.count + 1 ELSE 1 END,
             reset_at = CASE WHEN attempts.reset_at > now() THEN attempts.reset_at ELSE now() + make_interval(mins => $2::int) END`,
    [key, minutes]);
}
export async function clearLimit(key) { await q('DELETE FROM attempts WHERE key = $1', [key]); }

/* ---------------- Campaign ---------------- */
export const CATEGORIES = ['Kesehatan', 'Air Bersih', 'Pendidikan', 'Sosial', 'Kemanusiaan', 'Keagamaan', 'Ekonomi', 'Bencana', 'Umum'];

export const CAMPAIGN_COLS = `id, slug, title, category, summary, story, story_html,
  target::float8 AS target, collected::float8 AS collected, donors,
  to_char(deadline, 'YYYY-MM-DD') AS deadline, images, visible, sort, created_at, updated_at`;

export const PUBLIC_COLS = `id, slug, title, category, summary, story, story_html,
  target::float8 AS target, collected::float8 AS collected, donors,
  to_char(deadline, 'YYYY-MM-DD') AS deadline, images, updated_at`;

export const PUBLIC_LIST_COLS = `slug, title, category, summary,
  target::float8 AS target, collected::float8 AS collected, donors,
  to_char(deadline, 'YYYY-MM-DD') AS deadline, images, updated_at`;

// Hitung ulang dana terkumpul & jumlah donatur dari catatan donasi.
export async function recomputeTotals(campaignId) {
  await q(`UPDATE campaigns c SET
      collected = coalesce((SELECT sum(amount) FROM donations WHERE campaign_id = c.id AND status = 'approved'), 0),
      donors = coalesce((SELECT sum(donor_count) FROM donations WHERE campaign_id = c.id AND status = 'approved'), 0),
      updated_at = now()
    WHERE c.id = $1`, [campaignId]);
}

/* ---------------- Pembersih HTML cerita (allowlist) ---------------- */
const ALLOWED_TAGS = { p: 'p', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u',
  h2: 'h3', h3: 'h3', h4: 'h3', blockquote: 'blockquote', ul: 'ul', ol: 'ol', li: 'li', img: 'img', figure: 'figure', figcaption: 'figcaption' };
const VOID_TAGS = new Set(['br', 'img']);
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function attr(attrs, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(' ' + attrs);
  if (!m) return '';
  return (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}
export function sanitizeStory(html) {
  let s = String(html || '');
  if (s.length > 200000) throw new HttpError(400, 'Cerita terlalu panjang.');
  s = s.replace(/<!--[\s\S]*?-->/g, '')
       .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
       .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math)\b[^>]*>/gi, '');
  const out = [];
  const parts = s.split(/(<[^>]*>)/);
  for (const part of parts) {
    if (!part) continue;
    if (part[0] !== '<' || !part.endsWith('>')) { out.push(part.replace(/</g, '&lt;').replace(/>/g, '&gt;')); continue; }
    const m = /^<\s*(\/)?\s*([a-zA-Z0-9]+)([^>]*)>$/.exec(part);
    if (!m) continue;
    const tag = ALLOWED_TAGS[m[2].toLowerCase()];
    if (!tag) continue;
    if (m[1]) { if (!VOID_TAGS.has(tag)) out.push(`</${tag}>`); continue; }
    if (tag === 'img') {
      const src = attr(m[3], 'src');
      if (!isImageUrl(src)) continue;
      out.push(`<img src="${escAttr(src)}" alt="${escAttr(attr(m[3], 'alt').slice(0, 200))}" loading="lazy">`);
      continue;
    }
    out.push(`<${tag}>`);
  }
  return out.join('').replace(/(<p>\s*(<br>)?\s*<\/p>\s*){2,}/g, '<p><br></p>').trim();
}
export function htmlToText(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h3|blockquote|li|figure)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
export function imagesInHtml(html) {
  const urls = []; const re = /<img[^>]+src="([^"]+)"/gi; let m;
  while ((m = re.exec(String(html || '')))) urls.push(m[1].replace(/&amp;/g, '&'));
  return urls;
}

export function cleanDate(v, label) {
  if (!v) return new Date().toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${label} tidak valid.`);
  return s;
}
export function cleanMoney(v, label, min = 0) {
  const n = Math.round(Number(String(v ?? 0).replace(/[^\d]/g, '') || 0));
  if (!Number.isFinite(n) || n < min || n > 1e12) throw new HttpError(400, `${label} tidak valid.`);
  return n;
}
export function cleanOptionalImage(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!isImageUrl(s)) throw new HttpError(400, 'Alamat foto tidak valid.');
  return s;
}

export function isBlobUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && x.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch { return false; }
}

// Foto campaign boleh dari Vercel Blob atau dari folder website sendiri (/assets/img/campaign/...).
export function isImageUrl(u) {
  return isBlobUrl(u) || /^\/assets\/img\/campaign\/[a-z0-9._-]+\.(webp|jpe?g|png)$/i.test(String(u));
}

function toInt(v, min, max, label) {
  const n = Math.round(Number(String(v ?? 0).replace(/[^\d-]/g, '') || 0));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} tidak valid.`);
  return n;
}

export function cleanCampaign(b) {
  const title = String(b.title || '').trim();
  if (title.length < 5 || title.length > 160) throw new HttpError(400, 'Judul harus 5–160 karakter.');
  const summary = String(b.summary || '').trim();
  if (summary.length < 10 || summary.length > 240) throw new HttpError(400, 'Deskripsi singkat harus 10–240 karakter.');
  const story_html = sanitizeStory(b.story_html || '');
  const story = htmlToText(story_html).slice(0, 50000);
  const category = CATEGORIES.includes(b.category) ? b.category : 'Umum';
  const target = toInt(b.target, 0, 1e12, 'Target dana');
  const sort = toInt(b.sort, -9999, 9999, 'Urutan');
  let deadline = b.deadline ? String(b.deadline).trim() : null;
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new HttpError(400, 'Batas waktu tidak valid.');
  const images = Array.isArray(b.images) ? b.images.map(String) : [];
  if (!images.length) throw new HttpError(400, 'Tambahkan minimal 1 foto.');
  if (images.length > 4) throw new HttpError(400, 'Maksimal 4 foto.');
  if (!images.every(isImageUrl)) throw new HttpError(400, 'Alamat foto tidak valid.');
  return { title, summary, story, story_html, category, target, deadline, images, sort, visible: !!b.visible };
}

export function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'campaign';
}

export async function uniqueSlug(title, exceptId = 0) {
  const base = slugify(title);
  const rows = await q('SELECT slug FROM campaigns WHERE (slug = $1 OR slug LIKE $2) AND id <> $3', [base, base + '-%', exceptId]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}
