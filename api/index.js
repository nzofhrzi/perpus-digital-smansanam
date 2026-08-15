import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');

// ─────────────────────────────────────────────────────────────────────────
// AUTH: JWT SEDERHANA (HMAC-SHA256)
// ─────────────────────────────────────────────────────────────────────────
function generateToken(payload) {
  const secret = process.env.JWT_SECRET || 'perpus-smansanam-default-secret';
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  try {
    const secret = process.env.JWT_SECRET || 'perpus-smansanam-default-secret';
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Format token tidak valid');
    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    if (signature !== expectedSignature) throw new Error('Signature tidak valid');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token kedaluwarsa');
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, storedHash) {
  try {
    const computed = hashPassword(password, salt);
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getBearerToken(headers) {
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  return parts.length === 2 ? parts[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────
// PENYIMPANAN DATA: GITHUB API (PRODUKSI) DENGAN FALLBACK FILESYSTEM LOKAL
// ─────────────────────────────────────────────────────────────────────────
const GITHUB_API = 'https://api.github.com';

function githubConfigured() {
  return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER && process.env.GITHUB_REPO);
}

async function getGitHubFile(relPath) {
  const cacheBuster = Date.now();
  const branch = process.env.GITHUB_BRANCH || 'main';
  const response = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${relPath}?ref=${branch}&_=${cacheBuster}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3.raw',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    }
  );
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
  return await response.text();
}

async function updateGitHubFile(relPath, content, message) {
  const shaResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${relPath}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json'
      }
    }
  );
  let sha = '';
  if (shaResponse.ok) {
    const data = await shaResponse.json();
    sha = data.sha;
  }
  const updateResponse = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${relPath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message || `Update ${relPath}`,
        content: Buffer.from(content).toString('base64'),
        sha: sha || undefined,
        branch: process.env.GITHUB_BRANCH || 'main'
      })
    }
  );
  if (!updateResponse.ok) throw new Error(`Gagal update file: ${updateResponse.status}`);
  return await updateResponse.json();
}

async function readDataFile(relPath) {
  if (githubConfigured()) {
    try {
      return await getGitHubFile(`data/${relPath}`);
    } catch (err) {
      // fallback ke lokal jika gagal
    }
  }
  const localPath = path.join(LOCAL_DATA_DIR, relPath);
  return fs.readFileSync(localPath, 'utf-8');
}

async function writeDataFile(relPath, content, message) {
  if (githubConfigured()) {
    return await updateGitHubFile(`data/${relPath}`, content, message);
  }
  // fallback: tulis ke filesystem lokal (mode dev / vercel dev)
  const localPath = path.join(LOCAL_DATA_DIR, relPath);
  try {
    fs.writeFileSync(localPath, content, 'utf-8');
    return { local: true };
  } catch (err) {
    // Pada Vercel production tanpa GitHub, filesystem read-only -> abaikan (best effort)
    return { local: false, skipped: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER RESPON JSON
// ─────────────────────────────────────────────────────────────────────────
function sendJson(res, status, obj) {
  res.status(status).json(obj);
}

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { method, url, headers } = req;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const pathname = new URL(`http://localhost${url}`).pathname;
    const parts = pathname.split('/').filter(Boolean); // ['api', ...]

    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const route = parts.slice(1).join('/'); // path setelah /api/

    // ─── HEALTH CHECK ─────────────────────────────────────────────────
    if (method === 'GET' && route === 'health') {
      return sendJson(res, 200, { status: 'ok', app: 'Perpus Digital Smansanam' });
    }

    // ─── LOGIN ANGGOTA (SISWA / GURU / STAF) ─────────────────────────
    if (method === 'POST' && route === 'auth/login') {
      const { nama, status, kelas, password } = body;

      if (!nama || !status || !password) {
        return sendJson(res, 400, { message: 'Nama, status/jabatan, dan password wajib diisi.' });
      }
      if (status === 'siswa' && !kelas) {
        return sendJson(res, 400, { message: 'Kelas wajib diisi untuk status siswa.' });
      }

      let usersData;
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
      } catch {
        return sendJson(res, 500, { message: 'Data pengguna tidak dapat dimuat.' });
      }

      const cleanNama = String(nama).trim().toLowerCase();
      const user = (usersData.users || []).find(
        (u) => u.nama.trim().toLowerCase() === cleanNama && u.status === status
      );

      if (!user) {
        return sendJson(res, 401, { message: 'Nama atau status tidak ditemukan. Periksa kembali data Anda.' });
      }
      if (status === 'siswa' && (user.kelas || '').trim().toLowerCase() !== String(kelas).trim().toLowerCase()) {
        return sendJson(res, 401, { message: 'Kelas tidak sesuai dengan data yang terdaftar.' });
      }
      if (!verifyPassword(password, user.salt, user.hash)) {
        return sendJson(res, 401, { message: 'Password salah.' });
      }

      const token = generateToken({
        sub: user.id,
        nama: user.nama,
        status: user.status,
        kelas: user.kelas || null,
        role: user.status,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 // 12 jam
      });

      return sendJson(res, 200, {
        token,
        user: { id: user.id, nama: user.nama, status: user.status, kelas: user.kelas || null, role: user.status }
      });
    }

    // ─── LOGIN TAMU ────────────────────────────────────────────────────
    if (method === 'POST' && route === 'auth/guest') {
      const { nama, jabatan, umur } = body;

      if (!nama || !jabatan || !umur) {
        return sendJson(res, 400, { message: 'Nama, jabatan/keperluan, dan umur wajib diisi.' });
      }
      const umurNum = parseInt(umur, 10);
      if (isNaN(umurNum) || umurNum <= 0 || umurNum > 120) {
        return sendJson(res, 400, { message: 'Umur tidak valid.' });
      }

      const guestId = `tamu_${Date.now()}`;
      const guestEntry = {
        id: guestId,
        nama: String(nama).trim(),
        jabatan: String(jabatan).trim(),
        umur: umurNum,
        waktuKunjungan: new Date().toISOString()
      };

      try {
        let guestsData = { guests: [] };
        try {
          guestsData = JSON.parse(await readDataFile('guests.json'));
        } catch {}
        guestsData.guests.push(guestEntry);
        await writeDataFile('guests.json', JSON.stringify(guestsData, null, 2), `Kunjungan tamu: ${guestEntry.nama}`);
      } catch (err) {
        // Best-effort: tetap izinkan login tamu walau pencatatan gagal
      }

      const token = generateToken({
        sub: guestId,
        nama: guestEntry.nama,
        status: 'tamu',
        jabatan: guestEntry.jabatan,
        umur: umurNum,
        kelas: null,
        role: 'tamu',
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 3 // 3 jam untuk tamu
      });

      return sendJson(res, 200, {
        token,
        user: { id: guestId, nama: guestEntry.nama, status: 'tamu', jabatan: guestEntry.jabatan, umur: umurNum, role: 'tamu' }
      });
    }

    // ─── LOGIN ADMIN ───────────────────────────────────────────────────
    if (method === 'POST' && route === 'auth/admin-login') {
      const { username, password } = body;
      if (!username || !password) {
        return sendJson(res, 400, { message: 'Username dan password wajib diisi.' });
      }

      let adminData;
      try {
        adminData = JSON.parse(await readDataFile('admin.json'));
      } catch {
        return sendJson(res, 500, { message: 'Data admin tidak dapat dimuat.' });
      }

      const admin = (adminData.admins || []).find(
        (a) => a.username.toLowerCase() === String(username).trim().toLowerCase()
      );

      if (!admin || !verifyPassword(password, admin.salt, admin.hash)) {
        return sendJson(res, 401, { message: 'Username atau password admin salah.' });
      }

      const token = generateToken({
        sub: admin.id,
        nama: admin.nama,
        username: admin.username,
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
      });

      return sendJson(res, 200, {
        token,
        user: { id: admin.id, nama: admin.nama, username: admin.username, role: 'admin' }
      });
    }

    // ─── VERIFIKASI TOKEN (DIPAKAI DASHBOARD & ADMIN PANEL) ────────────
    if (method === 'GET' && route === 'auth/verify') {
      const token = getBearerToken(headers);
      if (!token) return sendJson(res, 401, { valid: false, message: 'Token tidak ditemukan.' });
      const payload = verifyToken(token);
      if (!payload) return sendJson(res, 401, { valid: false, message: 'Token tidak valid atau kedaluwarsa.' });
      return sendJson(res, 200, { valid: true, user: payload });
    }

    // ─── STATISTIK RINGKAS UNTUK DASHBOARD ADMIN (DUMMY SEMENTARA) ─────
    if (method === 'GET' && route === 'admin/stats') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let totalAnggota = 0;
      let totalTamuHariIni = 0;
      try {
        const usersData = JSON.parse(await readDataFile('users.json'));
        totalAnggota = (usersData.users || []).length;
      } catch {}
      try {
        const guestsData = JSON.parse(await readDataFile('guests.json'));
        const today = new Date().toISOString().slice(0, 10);
        totalTamuHariIni = (guestsData.guests || []).filter((g) => (g.waktuKunjungan || '').slice(0, 10) === today).length;
      } catch {}

      return sendJson(res, 200, {
        totalAnggota,
        totalTamuHariIni,
        totalBuku: 0,
        kunjunganHariIni: totalTamuHariIni
      });
    }

    // ─── 404 ────────────────────────────────────────────────────────────
    return sendJson(res, 404, { message: 'Endpoint tidak ditemukan.' });
  } catch (err) {
    return sendJson(res, 500, { message: 'Terjadi kesalahan pada server.', error: String(err && err.message ? err.message : err) });
  }
}
