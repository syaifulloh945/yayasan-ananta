// GET  /api/auth?action=me
// POST /api/auth?action=login   { username, password }
// POST /api/auth?action=logout
// POST /api/auth?action=forgot  { username, code, newPassword }   (code = Kode Pemulihan atau Kunci Darurat)
import {
  handler, HttpError, q, body, requirePost, clientIp,
  verifySecret, hashSecret, newRecoveryCode, normalizeCode, checkPasswordStrength, matchesEmergencyKey,
  makeSessionCookie, clearSessionCookie, currentAdmin,
  checkLimit, hitLimit, clearLimit
} from './_lib.js';

const pub = (a) => ({ id: a.id, username: a.username, name: a.name });

export default handler(async (req, res) => {
  const action = String(req.query.action || '');

  if (action === 'me' && req.method === 'GET') {
    const a = await currentAdmin(req);
    if (!a) throw new HttpError(401, 'Belum login.');
    return res.status(200).json({ ok: true, admin: pub(a) });
  }

  requirePost(req);
  const b = body(req);
  const ip = clientIp(req);

  if (action === 'login') {
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!username || !password) throw new HttpError(400, 'Isi username dan password.');
    const kIp = `login-ip:${ip}`, kUser = `login-user:${username}`;
    await checkLimit(kIp, 10);
    await checkLimit(kUser, 8);
    const rows = await q('SELECT id, username, name, pass_hash, pass_ver FROM admins WHERE lower(username) = $1', [username]);
    const a = rows[0];
    if (!a || !verifySecret(password, a.pass_hash)) {
      await hitLimit(kIp); await hitLimit(kUser);
      throw new HttpError(401, 'Username atau password salah.');
    }
    await clearLimit(kUser);
    await q('UPDATE admins SET last_login = now() WHERE id = $1', [a.id]);
    res.setHeader('Set-Cookie', makeSessionCookie(a));
    return res.status(200).json({ ok: true, admin: pub(a) });
  }

  if (action === 'logout') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }

  if (action === 'forgot') {
    const username = String(b.username || '').trim().toLowerCase();
    const code = String(b.code || '');
    const newPassword = String(b.newPassword || '');
    if (!username || !code) throw new HttpError(400, 'Isi username dan Kode Pemulihan.');
    checkPasswordStrength(newPassword);
    const kIp = `forgot-ip:${ip}`;
    await checkLimit(kIp, 6);
    const rows = await q('SELECT id, recovery_hash FROM admins WHERE lower(username) = $1', [username]);
    const a = rows[0];
    const valid = a && (verifySecret(normalizeCode(code), a.recovery_hash) || matchesEmergencyKey(code));
    if (!valid) {
      await hitLimit(kIp, 30);
      throw new HttpError(401, 'Username atau Kode Pemulihan salah.');
    }
    const rec = newRecoveryCode();
    await q('UPDATE admins SET pass_hash = $1, recovery_hash = $2, pass_ver = pass_ver + 1 WHERE id = $3',
      [hashSecret(newPassword), rec.hash, a.id]);
    await clearLimit(kIp);
    return res.status(200).json({ ok: true, recoveryCode: rec.plain });
  }

  throw new HttpError(404, 'Aksi tidak dikenal.');
});
