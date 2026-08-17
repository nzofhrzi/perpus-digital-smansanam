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

// ─────────────────────────────────────────────────────────────────────────
// DAFTAR ALASAN KUNJUNGAN (DROPDOWN ABSENSI)
// ─────────────────────────────────────────────────────────────────────────
const ALASAN_KUNJUNGAN = [
  'Membaca Buku',
  'Meminjam Buku',
  'Mengembalikan Buku',
  'Mengerjakan Tugas',
  'Diskusi Kelompok',
  'Kunjungan Kelas',
  'Podcast',
  'Lainnya'
];

// ─────────────────────────────────────────────────────────────────────────
// HELPER TANGGAL & WAKTU (ZONA WAKTU ASIA/JAKARTA / WIB)
// ─────────────────────────────────────────────────────────────────────────
function todayJakarta() {
  // Format en-CA menghasilkan YYYY-MM-DD, konsisten untuk pengelompokan per hari
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function generateAttendanceId() {
  return `abs_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// QR ABSENSI: PREFIX PENANDA KHUSUS (BUKAN URL, TIDAK MENGARAH KE MANA PUN
// JIKA DIPINDAI APLIKASI KAMERA BIASA — HANYA DIKENALI OLEH SCANNER DI WEBSITE INI)
// ─────────────────────────────────────────────────────────────────────────
const QR_ABSEN_PREFIX = 'PERPUS-ABSEN::';

function generateKodeAbsenQR() {
  return crypto.randomBytes(12).toString('hex');
}

function generateReadingId() {
  return `read_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// TRACKING PEMBACA: BATAS WAJAR DURASI SESI
// ─────────────────────────────────────────────────────────────────────────
// Jika overlay tidak tertutup normal (mis. tab/browser ditutup paksa, koneksi
// putus), sesi bisa "menggantung" (selesai = null) selamanya. Batas ini
// mencegah durasi membengkak tak wajar saat sesi seperti itu dihitung.
const MAX_DURASI_SESI_DETIK = 2 * 60 * 60; // 2 jam

function hitungDurasiEfektif(session, nowMs) {
  if (session.selesai) return session.durasiDetik || 0;
  const mulaiMs = new Date(session.mulai).getTime();
  const berjalan = Math.floor((nowMs - mulaiMs) / 1000);
  return Math.max(0, Math.min(berjalan, MAX_DURASI_SESI_DETIK));
}

function getBearerToken(headers) {
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  return parts.length === 2 ? parts[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────
// HELPER LINK GOOGLE DRIVE → LINK UNDUH LANGSUNG
// ─────────────────────────────────────────────────────────────────────────
function extractDriveFileId(link) {
  if (!link) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,       // .../file/d/ID/view
    /[?&]id=([a-zA-Z0-9_-]+)/,           // ...?id=ID atau &id=ID
    /\/d\/([a-zA-Z0-9_-]+)/              // .../d/ID
  ];
  for (const re of patterns) {
    const m = link.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function isGoogleDriveLink(link) {
  return /drive\.google\.com/i.test(link || '');
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
        user: { id: user.id, nama: user.nama, status: user.status, kelas: user.kelas || null, jabatan: user.jabatan || null, role: user.status, foto: user.foto || null }
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

    // ─── PENDAFTARAN MANDIRI ANGGOTA SEKOLAH (SISWA / GURU / STAF) ───────
    if (method === 'POST' && route === 'auth/register') {
      const { nama, status, kelas, jabatan, password, confirmPassword } = body;

      if (!nama || !String(nama).trim()) {
        return sendJson(res, 400, { message: 'Nama lengkap wajib diisi.' });
      }
      if (!['siswa', 'guru', 'staf'].includes(status)) {
        return sendJson(res, 400, { message: 'Status/jabatan tidak valid.' });
      }
      if (status === 'siswa' && !kelas) {
        return sendJson(res, 400, { message: 'Kelas wajib diisi untuk status siswa.' });
      }
      if (!password || String(password).length < 4) {
        return sendJson(res, 400, { message: 'Password minimal 4 karakter.' });
      }
      if (confirmPassword !== undefined && password !== confirmPassword) {
        return sendJson(res, 400, { message: 'Konfirmasi password tidak sama.' });
      }

      let usersData = { users: [] };
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
        if (!Array.isArray(usersData.users)) usersData.users = [];
      } catch {
        usersData = { users: [] };
      }

      const cleanNama = String(nama).trim().toLowerCase();
      const sudahAda = usersData.users.find(
        (u) => u.nama.trim().toLowerCase() === cleanNama && u.status === status
      );
      if (sudahAda) {
        return sendJson(res, 409, { message: 'Akun dengan nama dan status ini sudah terdaftar. Silakan masuk (login) atau hubungi admin jika ini kesalahan.' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      const newUser = {
        id: `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        nama: String(nama).trim(),
        status,
        kelas: status === 'siswa' ? String(kelas).trim() : null,
        jabatan: status !== 'siswa' ? (jabatan ? String(jabatan).trim() : '') : null,
        foto: null,
        salt,
        hash,
        createdAt: new Date().toISOString(),
        daftarMandiri: true
      };

      usersData.users.push(newUser);
      try {
        await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Pendaftaran mandiri: ${newUser.nama}`);
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menyimpan pendaftaran. Silakan coba lagi.' });
      }

      const token = generateToken({
        sub: newUser.id,
        nama: newUser.nama,
        status: newUser.status,
        kelas: newUser.kelas || null,
        jabatan: newUser.jabatan || null,
        role: newUser.status,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
      });

      return sendJson(res, 201, {
        message: 'Pendaftaran berhasil! Selamat datang.',
        token,
        user: { id: newUser.id, nama: newUser.nama, status: newUser.status, kelas: newUser.kelas, jabatan: newUser.jabatan, role: newUser.status, foto: null }
      });
    }

    // ─── PROFIL SAYA: UPDATE DATA & GANTI PASSWORD (ANGGOTA LOGIN) ───────
    if (method === 'PUT' && route === 'auth/profile') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !['siswa', 'guru', 'staf'].includes(payload.role)) {
        return sendJson(res, 401, { message: 'Sesi tidak valid atau fitur ini khusus anggota sekolah.' });
      }

      const { nama, kelas, jabatan, currentPassword, newPassword, confirmNewPassword, foto, hapusFoto } = body;

      let usersData = { users: [] };
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
        if (!Array.isArray(usersData.users)) usersData.users = [];
      } catch {
        return sendJson(res, 500, { message: 'Data pengguna tidak dapat dimuat.' });
      }

      const idx = usersData.users.findIndex((u) => u.id === payload.sub);
      if (idx === -1) {
        return sendJson(res, 404, { message: 'Akun tidak ditemukan.' });
      }
      const user = usersData.users[idx];

      const updated = { ...user };

      if (nama !== undefined) {
        const cleanNama = String(nama).trim();
        if (!cleanNama) {
          return sendJson(res, 400, { message: 'Nama tidak boleh kosong.' });
        }
        const cleanNamaLower = cleanNama.toLowerCase();
        const bentrok = usersData.users.find(
          (u) => u.id !== user.id && u.nama.trim().toLowerCase() === cleanNamaLower && u.status === user.status
        );
        if (bentrok) {
          return sendJson(res, 409, { message: 'Nama tersebut sudah digunakan oleh akun lain dengan status yang sama.' });
        }
        updated.nama = cleanNama;
      }

      if (user.status === 'siswa' && kelas !== undefined) {
        if (!String(kelas).trim()) {
          return sendJson(res, 400, { message: 'Kelas tidak boleh kosong.' });
        }
        updated.kelas = String(kelas).trim();
      }
      if (user.status !== 'siswa' && jabatan !== undefined) {
        updated.jabatan = String(jabatan).trim();
      }

      // ── FOTO PROFIL (BASE64 DATA URL, SISI KLIEN SUDAH DIKOMPRES/DIRESIZE) ──
      if (hapusFoto === true) {
        updated.foto = null;
      } else if (foto !== undefined && foto !== null) {
        const fotoStr = String(foto);
        if (!/^data:image\/(png|jpe?g|webp);base64,/.test(fotoStr)) {
          return sendJson(res, 400, { message: 'Format foto tidak valid. Gunakan gambar PNG, JPG, atau WEBP.' });
        }
        // Batas ukuran ± 900KB (data URL base64), aman untuk disimpan di users.json.
        if (fotoStr.length > 1_200_000) {
          return sendJson(res, 400, { message: 'Ukuran foto terlalu besar. Gunakan foto yang lebih kecil.' });
        }
        updated.foto = fotoStr;
      }

      if (newPassword) {
        if (!currentPassword) {
          return sendJson(res, 400, { message: 'Masukkan password saat ini untuk mengganti password.' });
        }
        if (!verifyPassword(currentPassword, user.salt, user.hash)) {
          return sendJson(res, 401, { message: 'Password saat ini salah.' });
        }
        if (String(newPassword).length < 4) {
          return sendJson(res, 400, { message: 'Password baru minimal 4 karakter.' });
        }
        if (confirmNewPassword !== undefined && newPassword !== confirmNewPassword) {
          return sendJson(res, 400, { message: 'Konfirmasi password baru tidak sama.' });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        updated.salt = salt;
        updated.hash = hashPassword(newPassword, salt);
      }

      usersData.users[idx] = updated;
      try {
        await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Update profil: ${updated.nama}`);
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menyimpan perubahan profil.' });
      }

      const newToken = generateToken({
        sub: updated.id,
        nama: updated.nama,
        status: updated.status,
        kelas: updated.kelas || null,
        jabatan: updated.jabatan || null,
        role: updated.status,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
      });

      return sendJson(res, 200, {
        message: 'Profil berhasil diperbarui.',
        token: newToken,
        user: { id: updated.id, nama: updated.nama, status: updated.status, kelas: updated.kelas, jabatan: updated.jabatan, role: updated.status, foto: updated.foto || null }
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

    // ─── STATISTIK RINGKAS UNTUK DASHBOARD ADMIN ────────────────────────
    if (method === 'GET' && route === 'admin/stats') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const today = todayJakarta();
      let totalAnggota = 0;
      let totalTamuHariIni = 0;
      let kunjunganHariIni = 0;
      let alasanHariIni = {};
      let totalBuku = 0;

      try {
        const usersData = JSON.parse(await readDataFile('users.json'));
        totalAnggota = (usersData.users || []).length;
      } catch {}
      try {
        const guestsData = JSON.parse(await readDataFile('guests.json'));
        totalTamuHariIni = (guestsData.guests || []).filter((g) => (g.waktuKunjungan || '').slice(0, 10) === today).length;
      } catch {}
      try {
        const attendanceData = JSON.parse(await readDataFile('attendance.json'));
        const list = Array.isArray(attendanceData.attendance) ? attendanceData.attendance : [];
        const listHariIni = list.filter((a) => a.tanggal === today);
        kunjunganHariIni = listHariIni.length;
        alasanHariIni = listHariIni.reduce((acc, a) => {
          const key = a.alasan || 'Lainnya';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
      } catch {}
      try {
        const booksData = JSON.parse(await readDataFile('books.json'));
        totalBuku = (booksData.books || []).length;
      } catch {}

      return sendJson(res, 200, {
        totalAnggota,
        totalTamuHariIni,
        totalBuku,
        kunjunganHariIni,
        alasanHariIni
      });
    }

    // ─── ABSEN KEHADIRAN (1x PER HARI) ──────────────────────────────────
    if (method === 'POST' && route === 'attendance/absen') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali.' });
      }

      const alasan = String(body.alasan || '').trim();
      if (!alasan) {
        return sendJson(res, 400, { message: 'Alasan kunjungan wajib dipilih.' });
      }
      if (!ALASAN_KUNJUNGAN.includes(alasan)) {
        return sendJson(res, 400, { message: 'Alasan kunjungan tidak valid.' });
      }

      // ─── VALIDASI QR ABSENSI (QR 2 — KHUSUS ABSEN, DIPINDAI FISIK DI PERPUSTAKAAN) ───
      const kodeQR = String(body.kodeQR || '').trim();
      let settingsUntukQR = {};
      try {
        settingsUntukQR = JSON.parse(await readDataFile('settings.json'));
      } catch {}
      const kodeAbsenAktif = settingsUntukQR.kodeAbsenQR || '';
      if (!kodeAbsenAktif) {
        return sendJson(res, 400, { message: 'QR Code Absensi belum diatur oleh admin. Silakan hubungi petugas perpustakaan.' });
      }
      if (!kodeQR || kodeQR !== `${QR_ABSEN_PREFIX}${kodeAbsenAktif}`) {
        return sendJson(res, 400, { message: 'QR Code tidak valid. Pastikan Anda memindai QR Code Absensi resmi yang tersedia di perpustakaan.' });
      }

      const today = todayJakarta();

      let attendanceData = { attendance: [] };
      try {
        attendanceData = JSON.parse(await readDataFile('attendance.json'));
        if (!Array.isArray(attendanceData.attendance)) attendanceData.attendance = [];
      } catch {
        attendanceData = { attendance: [] };
      }

      const sudahAbsen = attendanceData.attendance.find(
        (a) => a.userId === payload.sub && a.tanggal === today
      );
      if (sudahAbsen) {
        return sendJson(res, 400, { message: 'Anda sudah melakukan absensi hari ini.' });
      }

      const record = {
        id: generateAttendanceId(),
        userId: payload.sub,
        nama: payload.nama,
        status: payload.status || payload.role,
        kelas: payload.kelas || null,
        jabatan: payload.jabatan || null,
        alasan,
        tanggal: today,
        waktuAbsen: new Date().toISOString()
      };

      attendanceData.attendance.push(record);
      try {
        await writeDataFile('attendance.json', JSON.stringify(attendanceData, null, 2), `Absen: ${record.nama}`);
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menyimpan absensi. Silakan coba lagi.' });
      }

      return sendJson(res, 200, { message: 'Absensi berhasil dicatat.', record });
    }

    // ─── RIWAYAT & STATUS ABSENSI PENGGUNA YANG SEDANG LOGIN ────────────
    if (method === 'GET' && route === 'attendance/me') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali.' });
      }

      let attendanceData = { attendance: [] };
      try {
        attendanceData = JSON.parse(await readDataFile('attendance.json'));
        if (!Array.isArray(attendanceData.attendance)) attendanceData.attendance = [];
      } catch {}

      const milik = attendanceData.attendance
        .filter((a) => a.userId === payload.sub)
        .sort((a, b) => new Date(b.waktuAbsen) - new Date(a.waktuAbsen));

      const today = todayJakarta();
      const sudahAbsenHariIni = milik.find((a) => a.tanggal === today) || null;
      const bulanIni = today.slice(0, 7);
      const totalBulanIni = milik.filter((a) => a.tanggal.slice(0, 7) === bulanIni).length;

      return sendJson(res, 200, {
        sudahAbsenHariIni,
        totalBulanIni,
        riwayat: milik.slice(0, 30),
        daftarAlasan: ALASAN_KUNJUNGAN
      });
    }

    // ─── REKAP ABSENSI UNTUK ADMIN ───────────────────────────────────────
    if (method === 'GET' && route === 'attendance') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let attendanceData = { attendance: [] };
      try {
        attendanceData = JSON.parse(await readDataFile('attendance.json'));
        if (!Array.isArray(attendanceData.attendance)) attendanceData.attendance = [];
      } catch {}

      const reqUrl = new URL(`http://localhost${url}`);
      const tanggal = reqUrl.searchParams.get('tanggal');
      const statusFilter = reqUrl.searchParams.get('status');
      const alasanFilter = reqUrl.searchParams.get('alasan');
      const q = (reqUrl.searchParams.get('q') || '').trim().toLowerCase();

      let hasil = attendanceData.attendance;
      if (tanggal) hasil = hasil.filter((a) => a.tanggal === tanggal);
      if (statusFilter && statusFilter !== 'semua') hasil = hasil.filter((a) => a.status === statusFilter);
      if (alasanFilter && alasanFilter !== 'semua') hasil = hasil.filter((a) => a.alasan === alasanFilter);
      if (q) hasil = hasil.filter((a) => (a.nama || '').toLowerCase().includes(q));

      hasil = [...hasil].sort((a, b) => new Date(b.waktuAbsen) - new Date(a.waktuAbsen));

      const today = todayJakarta();
      const hariIni = attendanceData.attendance.filter((a) => a.tanggal === today).length;

      return sendJson(res, 200, {
        total: hasil.length,
        hariIni,
        daftarAlasan: ALASAN_KUNJUNGAN,
        data: hasil.slice(0, 300)
      });
    }

    // ─── HAPUS SATU CATATAN ABSENSI (ADMIN) ─────────────────────────────
    if (method === 'DELETE' && parts[1] === 'attendance' && parts[2]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let attendanceData = { attendance: [] };
      try {
        attendanceData = JSON.parse(await readDataFile('attendance.json'));
        if (!Array.isArray(attendanceData.attendance)) attendanceData.attendance = [];
      } catch {
        return sendJson(res, 500, { message: 'Data absensi tidak dapat dimuat.' });
      }

      const targetId = parts[2];
      const sebelum = attendanceData.attendance.length;
      attendanceData.attendance = attendanceData.attendance.filter((a) => a.id !== targetId);

      if (attendanceData.attendance.length === sebelum) {
        return sendJson(res, 404, { message: 'Catatan absensi tidak ditemukan.' });
      }

      try {
        await writeDataFile('attendance.json', JSON.stringify(attendanceData, null, 2), `Hapus catatan absensi: ${targetId}`);
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus catatan absensi.' });
      }

      return sendJson(res, 200, { message: 'Catatan absensi berhasil dihapus.' });
    }

    // ─── PROXY PDF (UNTUK GOOGLE DRIVE / SUMBER TANPA CORS) ─────────────
    if (method === 'GET' && route === 'pdf-proxy') {
      const reqUrl = new URL(`http://localhost${url}`);
      const rawLink = reqUrl.searchParams.get('url');
      if (!rawLink) {
        return sendJson(res, 400, { message: 'Parameter url wajib diisi.' });
      }
      if (!/^https?:\/\//i.test(rawLink)) {
        return sendJson(res, 400, { message: 'URL tidak valid.' });
      }

      // Hanya izinkan buku yang benar-benar terdaftar di books.json (cegah proxy disalahgunakan)
      let daftarLinkValid = [];
      try {
        const booksData = JSON.parse(await readDataFile('books.json'));
        daftarLinkValid = (booksData.books || []).map((b) => b.linkPDF).filter(Boolean);
      } catch {}
      if (!daftarLinkValid.includes(rawLink)) {
        return sendJson(res, 403, { message: 'Link PDF tidak dikenali dalam koleksi buku.' });
      }

      // Bangun URL unduh langsung jika link berasal dari Google Drive
      let targetUrl = rawLink;
      if (isGoogleDriveLink(rawLink)) {
        const fileId = extractDriveFileId(rawLink);
        if (!fileId) {
          return sendJson(res, 400, { message: 'Link Google Drive tidak valid. Gunakan link berbagi file (bukan folder).' });
        }
        targetUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      }

      try {
        let upstream = await fetch(targetUrl, { redirect: 'follow' });

        // Google Drive kadang mengembalikan halaman "konfirmasi virus scan" untuk file besar.
        // Deteksi dan coba ambil ulang dengan token konfirmasi.
        const contentType = upstream.headers.get('content-type') || '';
        if (isGoogleDriveLink(rawLink) && contentType.includes('text/html')) {
          const html = await upstream.text();
          const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
          const fileId = extractDriveFileId(rawLink);
          if (confirmMatch && fileId) {
            targetUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
            upstream = await fetch(targetUrl, { redirect: 'follow' });
          } else {
            return sendJson(res, 502, { message: 'Google Drive menolak akses langsung ke file ini. Pastikan file dibagikan sebagai "Semua orang yang memiliki link".' });
          }
        }

        if (!upstream.ok) {
          return sendJson(res, 502, { message: `Gagal mengambil file PDF (status ${upstream.status}).` });
        }

        const arrayBuffer = await upstream.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);

        // Validasi ringan: pastikan ini benar-benar file PDF
        const isPdf = buf.slice(0, 5).toString('utf-8') === '%PDF-';
        if (!isPdf) {
          return sendJson(res, 502, { message: 'File yang diambil bukan PDF valid. Periksa kembali link berbagi Google Drive.' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="buku.pdf"');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.status(200).send(buf);
        return;
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal memuat file PDF dari sumber.' });
      }
    }

    // ─── TRACKING PEMBACA: MULAI SESI BACA (SAAT OVERLAY DIBUKA) ────────
    if (method === 'POST' && route === 'reading/start') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali.' });
      }

      const bookId = String(body.bookId || '').trim();
      if (!bookId) {
        return sendJson(res, 400, { message: 'bookId wajib diisi.' });
      }

      let booksData = { books: [] };
      try {
        booksData = JSON.parse(await readDataFile('books.json'));
        if (!Array.isArray(booksData.books)) booksData.books = [];
      } catch {}
      const buku = booksData.books.find((b) => b.id === bookId);
      if (!buku) {
        return sendJson(res, 404, { message: 'Buku tidak ditemukan.' });
      }

      let readingData = { sessions: [] };
      try {
        readingData = JSON.parse(await readDataFile('reading.json'));
        if (!Array.isArray(readingData.sessions)) readingData.sessions = [];
      } catch {
        readingData = { sessions: [] };
      }

      const now = new Date();

      // Tutup otomatis sesi lama milik pengguna ini yang belum tertutup normal
      // (mis. overlay sebelumnya ditinggal tanpa menutup lewat tombol/Esc).
      readingData.sessions.forEach((s) => {
        if (s.userId === payload.sub && !s.selesai) {
          const durasi = hitungDurasiEfektif(s, now.getTime());
          s.selesai = now.toISOString();
          s.durasiDetik = durasi;
          s.ditutupOtomatis = true;
        }
      });

      const record = {
        id: generateReadingId(),
        userId: payload.sub,
        nama: payload.nama,
        status: payload.status || payload.role,
        kelas: payload.kelas || null,
        jabatan: payload.jabatan || null,
        bookId: buku.id,
        judulBuku: buku.judul,
        mulai: now.toISOString(),
        selesai: null,
        durasiDetik: 0,
        tanggal: todayJakarta()
      };

      readingData.sessions.push(record);
      try {
        await writeDataFile('reading.json', JSON.stringify(readingData, null, 2), `Mulai baca: ${payload.nama} - ${buku.judul}`);
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal mencatat sesi membaca.' });
      }

      return sendJson(res, 201, { message: 'Sesi membaca dimulai.', sessionId: record.id });
    }

    // ─── TRACKING PEMBACA: AKHIRI SESI BACA (SAAT OVERLAY DITUTUP) ──────
    if (method === 'POST' && route === 'reading/end') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali.' });
      }

      const sessionId = String(body.sessionId || '').trim();
      if (!sessionId) {
        return sendJson(res, 400, { message: 'sessionId wajib diisi.' });
      }

      let readingData = { sessions: [] };
      try {
        readingData = JSON.parse(await readDataFile('reading.json'));
        if (!Array.isArray(readingData.sessions)) readingData.sessions = [];
      } catch {
        return sendJson(res, 500, { message: 'Data tracking tidak dapat dimuat.' });
      }

      const idx = readingData.sessions.findIndex((s) => s.id === sessionId && s.userId === payload.sub);
      if (idx === -1) {
        // Sesi mungkin sudah ditutup otomatis oleh /reading/start berikutnya.
        // Tidak dianggap error keras agar tidak mengganggu pengalaman pengguna.
        return sendJson(res, 200, { message: 'Sesi tidak ditemukan (mungkin sudah tercatat selesai).' });
      }

      const session = readingData.sessions[idx];
      if (session.selesai) {
        return sendJson(res, 200, { message: 'Sesi sudah tercatat selesai sebelumnya.', durasiDetik: session.durasiDetik });
      }

      const now = new Date();
      const durasi = hitungDurasiEfektif(session, now.getTime());

      readingData.sessions[idx] = {
        ...session,
        selesai: now.toISOString(),
        durasiDetik: durasi
      };

      try {
        await writeDataFile('reading.json', JSON.stringify(readingData, null, 2), `Selesai baca: ${session.nama} - ${session.judulBuku} (${durasi}d)`);
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menyimpan durasi membaca.' });
      }

      return sendJson(res, 200, { message: 'Sesi membaca dicatat.', durasiDetik: durasi });
    }

    // ─── TRACKING PEMBACA: RIWAYAT & TOTAL WAKTU MILIK SENDIRI ──────────
    if (method === 'GET' && route === 'reading/me') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali.' });
      }

      let readingData = { sessions: [] };
      try {
        readingData = JSON.parse(await readDataFile('reading.json'));
        if (!Array.isArray(readingData.sessions)) readingData.sessions = [];
      } catch {}

      const now = Date.now();
      const milik = readingData.sessions
        .filter((s) => s.userId === payload.sub)
        .map((s) => ({ ...s, durasiDetik: hitungDurasiEfektif(s, now) }))
        .sort((a, b) => new Date(b.mulai) - new Date(a.mulai));

      const totalDetik = milik.reduce((acc, s) => acc + (s.durasiDetik || 0), 0);

      const perBukuMap = {};
      milik.forEach((s) => {
        if (!perBukuMap[s.bookId]) perBukuMap[s.bookId] = { bookId: s.bookId, judulBuku: s.judulBuku, totalDetik: 0, totalSesi: 0 };
        perBukuMap[s.bookId].totalDetik += s.durasiDetik || 0;
        perBukuMap[s.bookId].totalSesi += 1;
      });

      return sendJson(res, 200, {
        totalDetik,
        totalSesi: milik.length,
        perBuku: Object.values(perBukuMap).sort((a, b) => b.totalDetik - a.totalDetik),
        riwayat: milik.slice(0, 20)
      });
    }

    // ─── TRACKING PEMBACA: STATISTIK UNTUK ADMIN ────────────────────────
    if (method === 'GET' && route === 'reading/stats') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let readingData = { sessions: [] };
      try {
        readingData = JSON.parse(await readDataFile('reading.json'));
        if (!Array.isArray(readingData.sessions)) readingData.sessions = [];
      } catch {}

      const now = Date.now();
      const sesi = readingData.sessions.map((s) => ({ ...s, durasiDetik: hitungDurasiEfektif(s, now) }));

      const totalSesi = sesi.length;
      const totalDurasiDetik = sesi.reduce((acc, s) => acc + (s.durasiDetik || 0), 0);
      const sedangMembaca = sesi.filter((s) => !s.selesai).length;
      const today = todayJakarta();
      const aktivitasHariIni = sesi.filter((s) => s.tanggal === today).length;

      const bukuMap = {};
      const pembacaMap = {};
      sesi.forEach((s) => {
        if (!bukuMap[s.bookId]) bukuMap[s.bookId] = { bookId: s.bookId, judul: s.judulBuku, totalSesi: 0, totalDurasiDetik: 0 };
        bukuMap[s.bookId].totalSesi += 1;
        bukuMap[s.bookId].totalDurasiDetik += s.durasiDetik || 0;

        if (!pembacaMap[s.userId]) pembacaMap[s.userId] = { userId: s.userId, nama: s.nama, status: s.status, totalSesi: 0, totalDurasiDetik: 0 };
        pembacaMap[s.userId].totalSesi += 1;
        pembacaMap[s.userId].totalDurasiDetik += s.durasiDetik || 0;
      });

      const bukuTerpopuler = Object.values(bukuMap).sort((a, b) => b.totalDurasiDetik - a.totalDurasiDetik).slice(0, 10);
      const pembacaAktif = Object.values(pembacaMap).sort((a, b) => b.totalDurasiDetik - a.totalDurasiDetik).slice(0, 10);

      const aktivitasTerbaru = [...sesi]
        .sort((a, b) => new Date(b.mulai) - new Date(a.mulai))
        .slice(0, 20)
        .map((s) => ({
          nama: s.nama,
          status: s.status,
          judulBuku: s.judulBuku,
          mulai: s.mulai,
          selesai: s.selesai,
          durasiDetik: s.durasiDetik,
          sedangBerlangsung: !s.selesai
        }));

      return sendJson(res, 200, {
        totalSesi,
        totalDurasiDetik,
        sedangMembaca,
        aktivitasHariIni,
        bukuTerpopuler,
        pembacaAktif,
        aktivitasTerbaru
      });
    }

    // ─── BUKU: LIST & CRUD ──────────────────────────────────────────
    if (method === 'GET' && route === 'books') {
      let booksData = { books: [] };
      try {
        booksData = JSON.parse(await readDataFile('books.json'));
        if (!Array.isArray(booksData.books)) booksData.books = [];
      } catch {}
      return sendJson(res, 200, { books: booksData.books });
    }

    if (method === 'POST' && route === 'books') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const { judul, pengarang, penerbit, tahun, kategori, isbn, deskripsi, linkPDF, modeInput } = body;
      if (!judul) {
        return sendJson(res, 400, { message: 'Judul buku wajib diisi.' });
      }
      if (linkPDF && !/^https?:\/\//i.test(String(linkPDF).trim())) {
        return sendJson(res, 400, { message: 'Link PDF harus berupa URL valid (diawali http:// atau https://).' });
      }

      let booksData = { books: [] };
      try {
        booksData = JSON.parse(await readDataFile('books.json'));
        if (!Array.isArray(booksData.books)) booksData.books = [];
      } catch {
        booksData = { books: [] };
      }

      const newBook = {
        id: `book_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        judul,
        pengarang: pengarang || '-',
        penerbit: penerbit || '',
        tahun: tahun || new Date().getFullYear(),
        kategori: kategori || 'Umum',
        isbn: isbn || '',
        deskripsi: deskripsi || '',
        linkPDF: linkPDF ? String(linkPDF).trim() : '',
        modeInput: modeInput === 'simpel' ? 'simpel' : 'manual',
        dibuat: new Date().toISOString(),
        diperbarui: new Date().toISOString()
      };

      booksData.books.push(newBook);
      try {
        await writeDataFile('books.json', JSON.stringify(booksData, null, 2), `Tambah buku: ${judul}`);
        return sendJson(res, 201, { message: 'Buku berhasil ditambahkan.', book: newBook });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menambah buku.' });
      }
    }

    if (method === 'PUT' && parts[1] === 'books' && parts[2]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const bookId = parts[2];
      const { judul, pengarang, penerbit, tahun, kategori, isbn, deskripsi, linkPDF, modeInput } = body;
      if (linkPDF && !/^https?:\/\//i.test(String(linkPDF).trim())) {
        return sendJson(res, 400, { message: 'Link PDF harus berupa URL valid (diawali http:// atau https://).' });
      }

      let booksData = { books: [] };
      try {
        booksData = JSON.parse(await readDataFile('books.json'));
        if (!Array.isArray(booksData.books)) booksData.books = [];
      } catch {
        return sendJson(res, 500, { message: 'Data buku tidak dapat dimuat.' });
      }

      const bookIdx = booksData.books.findIndex((b) => b.id === bookId);
      if (bookIdx === -1) {
        return sendJson(res, 404, { message: 'Buku tidak ditemukan.' });
      }

      const updated = {
        ...booksData.books[bookIdx],
        judul: judul || booksData.books[bookIdx].judul,
        pengarang: pengarang || booksData.books[bookIdx].pengarang,
        penerbit: penerbit !== undefined ? penerbit : booksData.books[bookIdx].penerbit,
        tahun: tahun || booksData.books[bookIdx].tahun,
        kategori: kategori || booksData.books[bookIdx].kategori,
        isbn: isbn !== undefined ? isbn : booksData.books[bookIdx].isbn,
        deskripsi: deskripsi !== undefined ? deskripsi : booksData.books[bookIdx].deskripsi,
        linkPDF: linkPDF !== undefined ? String(linkPDF).trim() : booksData.books[bookIdx].linkPDF,
        modeInput: modeInput === 'simpel' || modeInput === 'manual' ? modeInput : booksData.books[bookIdx].modeInput,
        diperbarui: new Date().toISOString()
      };

      booksData.books[bookIdx] = updated;
      try {
        await writeDataFile('books.json', JSON.stringify(booksData, null, 2), `Update buku: ${updated.judul}`);
        return sendJson(res, 200, { message: 'Buku berhasil diperbarui.', book: updated });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal memperbarui buku.' });
      }
    }

    if (method === 'DELETE' && parts[1] === 'books' && parts[2]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const bookId = parts[2];
      let booksData = { books: [] };
      try {
        booksData = JSON.parse(await readDataFile('books.json'));
        if (!Array.isArray(booksData.books)) booksData.books = [];
      } catch {
        return sendJson(res, 500, { message: 'Data buku tidak dapat dimuat.' });
      }

      const sebelum = booksData.books.length;
      booksData.books = booksData.books.filter((b) => b.id !== bookId);

      if (booksData.books.length === sebelum) {
        return sendJson(res, 404, { message: 'Buku tidak ditemukan.' });
      }

      try {
        await writeDataFile('books.json', JSON.stringify(booksData, null, 2), `Hapus buku: ${bookId}`);
        return sendJson(res, 200, { message: 'Buku berhasil dihapus.' });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus buku.' });
      }
    }

    // ─── PENGGUNA: LIST & CRUD ──────────────────────────────────────
    if (method === 'GET' && route === 'users/list') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let usersData = { users: [] };
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
        if (!Array.isArray(usersData.users)) usersData.users = [];
      } catch {}
      
      const safe = usersData.users.map(u => ({
        id: u.id,
        nama: u.nama,
        status: u.status,
        kelas: u.kelas,
        jabatan: u.jabatan
      }));
      return sendJson(res, 200, { users: safe });
    }

    if (method === 'POST' && route === 'users') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const { nama, status, kelas, jabatan, password } = body;
      if (!nama || !status || !password) {
        return sendJson(res, 400, { message: 'Nama, status, dan password wajib diisi.' });
      }

      let usersData = { users: [] };
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
        if (!Array.isArray(usersData.users)) usersData.users = [];
      } catch {
        usersData = { users: [] };
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      const newUser = {
        id: `user_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        nama,
        status,
        kelas: status === 'siswa' ? (kelas || '') : null,
        jabatan: status !== 'siswa' ? (jabatan || '') : null,
        salt,
        hash
      };

      usersData.users.push(newUser);
      try {
        await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Tambah pengguna: ${nama}`);
        return sendJson(res, 201, { message: 'Pengguna berhasil ditambahkan.', user: { id: newUser.id, nama, status, kelas: newUser.kelas, jabatan: newUser.jabatan } });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menambah pengguna.' });
      }
    }

    if (method === 'PUT' && parts[1] === 'users' && parts[2]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const userId = parts[2];
      const { nama, status, kelas, jabatan, password } = body;

      let usersData = { users: [] };
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
        if (!Array.isArray(usersData.users)) usersData.users = [];
      } catch {
        return sendJson(res, 500, { message: 'Data pengguna tidak dapat dimuat.' });
      }

      const userIdx = usersData.users.findIndex((u) => u.id === userId);
      if (userIdx === -1) {
        return sendJson(res, 404, { message: 'Pengguna tidak ditemukan.' });
      }

      const updated = { ...usersData.users[userIdx] };
      if (nama) updated.nama = nama;
      if (status) updated.status = status;
      if (status === 'siswa') {
        updated.kelas = kelas || updated.kelas || '';
        updated.jabatan = null;
      } else {
        updated.jabatan = jabatan || updated.jabatan || '';
        updated.kelas = null;
      }
      if (password) {
        const salt = crypto.randomBytes(16).toString('hex');
        updated.salt = salt;
        updated.hash = hashPassword(password, salt);
      }

      usersData.users[userIdx] = updated;
      try {
        await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Update pengguna: ${updated.nama}`);
        return sendJson(res, 200, { message: 'Pengguna berhasil diperbarui.', user: { id: updated.id, nama: updated.nama, status: updated.status, kelas: updated.kelas, jabatan: updated.jabatan } });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal memperbarui pengguna.' });
      }
    }

    if (method === 'DELETE' && parts[1] === 'users' && parts[2]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const userId = parts[2];
      let usersData = { users: [] };
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
        if (!Array.isArray(usersData.users)) usersData.users = [];
      } catch {
        return sendJson(res, 500, { message: 'Data pengguna tidak dapat dimuat.' });
      }

      const sebelum = usersData.users.length;
      usersData.users = usersData.users.filter((u) => u.id !== userId);

      if (usersData.users.length === sebelum) {
        return sendJson(res, 404, { message: 'Pengguna tidak ditemukan.' });
      }

      try {
        await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Hapus pengguna: ${userId}`);
        return sendJson(res, 200, { message: 'Pengguna berhasil dihapus.' });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus pengguna.' });
      }
    }

    // ─── TAMU: LIST & DELETE ────────────────────────────────────────
    if (method === 'GET' && route === 'guests') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let guestsData = { guests: [] };
      try {
        guestsData = JSON.parse(await readDataFile('guests.json'));
        if (!Array.isArray(guestsData.guests)) guestsData.guests = [];
      } catch {}

      const reqUrl = new URL(`http://localhost${url}`);
      const q = (reqUrl.searchParams.get('q') || '').trim().toLowerCase();
      let hasil = guestsData.guests;
      if (q) hasil = hasil.filter((g) => (g.nama || '').toLowerCase().includes(q));
      hasil = [...hasil].sort((a, b) => new Date(b.waktuKunjungan) - new Date(a.waktuKunjungan));

      return sendJson(res, 200, { total: hasil.length, data: hasil.slice(0, 500) });
    }

    if (method === 'DELETE' && parts[1] === 'guests' && parts[2]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const guestId = parts[2];
      let guestsData = { guests: [] };
      try {
        guestsData = JSON.parse(await readDataFile('guests.json'));
        if (!Array.isArray(guestsData.guests)) guestsData.guests = [];
      } catch {
        return sendJson(res, 500, { message: 'Data tamu tidak dapat dimuat.' });
      }

      const sebelum = guestsData.guests.length;
      guestsData.guests = guestsData.guests.filter((g) => g.id !== guestId);

      if (guestsData.guests.length === sebelum) {
        return sendJson(res, 404, { message: 'Catatan tamu tidak ditemukan.' });
      }

      try {
        await writeDataFile('guests.json', JSON.stringify(guestsData, null, 2), `Hapus catatan tamu: ${guestId}`);
        return sendJson(res, 200, { message: 'Catatan tamu berhasil dihapus.' });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus catatan tamu.' });
      }
    }

    // ─── PENGATURAN: GET & PUT ──────────────────────────────────────
    if (method === 'GET' && route === 'settings') {
      let settingsData = { 
        namaSekolah: 'SMA Negeri Smansanam',
        namaPerpus: 'Perpus Digital Smansanam',
        logo: '📚',
        warna: '#059669',
        deskripsi: 'Sistem perpustakaan digital untuk sekolah kami',
        kodeAbsenQR: '',
        kodeAbsenQRDiperbarui: null
      };
      try {
        const data = JSON.parse(await readDataFile('settings.json'));
        settingsData = { ...settingsData, ...data };
      } catch {}
      return sendJson(res, 200, settingsData);
    }

    if (method === 'PUT' && route === 'settings') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      // Muat pengaturan yang ada agar field lain (mis. kode QR absen) tidak ikut tertimpa/hilang.
      let existing = {};
      try {
        existing = JSON.parse(await readDataFile('settings.json'));
      } catch {}

      const { namaSekolah, namaPerpus, logo, warna, deskripsi } = body;
      const settingsData = {
        ...existing,
        namaSekolah: namaSekolah || existing.namaSekolah || 'SMA Negeri Smansanam',
        namaPerpus: namaPerpus || existing.namaPerpus || 'Perpus Digital Smansanam',
        logo: logo || existing.logo || '📚',
        warna: warna || existing.warna || '#059669',
        deskripsi: deskripsi !== undefined ? deskripsi : (existing.deskripsi || 'Sistem perpustakaan digital')
      };

      try {
        await writeDataFile('settings.json', JSON.stringify(settingsData, null, 2), 'Update pengaturan');
        return sendJson(res, 200, { message: 'Pengaturan berhasil diperbarui.', settings: settingsData });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal memperbarui pengaturan.' });
      }
    }

    // ─── QR ABSENSI: BUAT / BUAT ULANG KODE QR 2 (KHUSUS ADMIN) ─────────
    if (method === 'POST' && route === 'settings/regenerate-qr-absen') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let existing = {};
      try {
        existing = JSON.parse(await readDataFile('settings.json'));
      } catch {}

      const kodeBaru = generateKodeAbsenQR();
      const settingsData = {
        ...existing,
        kodeAbsenQR: kodeBaru,
        kodeAbsenQRDiperbarui: new Date().toISOString()
      };

      try {
        await writeDataFile('settings.json', JSON.stringify(settingsData, null, 2), 'Buat ulang kode QR Absen');
        return sendJson(res, 200, {
          message: 'Kode QR Absen berhasil dibuat. Cetak & tempel QR 2 yang baru di perpustakaan.',
          kodeAbsenQR: settingsData.kodeAbsenQR,
          kodeAbsenQRDiperbarui: settingsData.kodeAbsenQRDiperbarui
        });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal membuat kode QR Absen.' });
      }
    }

    // ─── 404 ────────────────────────────────────────────────────────────
    return sendJson(res, 404, { message: 'Endpoint tidak ditemukan.' });
  } catch (err) {
    return sendJson(res, 500, { message: 'Terjadi kesalahan pada server.', error: String(err && err.message ? err.message : err) });
  }
}
