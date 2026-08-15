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

      return sendJson(res, 200, {
        totalAnggota,
        totalTamuHariIni,
        totalBuku: 0,
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

      const { judul, pengarang, penerbit, tahun, kategori, isbn, deskripsi } = body;
      if (!judul || !pengarang) {
        return sendJson(res, 400, { message: 'Judul dan pengarang wajib diisi.' });
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
        pengarang,
        penerbit: penerbit || '',
        tahun: tahun || new Date().getFullYear(),
        kategori: kategori || 'Umum',
        isbn: isbn || '',
        deskripsi: deskripsi || '',
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
      const { judul, pengarang, penerbit, tahun, kategori, isbn, deskripsi } = body;

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
        deskripsi: 'Sistem perpustakaan digital untuk sekolah kami'
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

      const { namaSekolah, namaPerpus, logo, warna, deskripsi } = body;
      const settingsData = {
        namaSekolah: namaSekolah || 'SMA Negeri Smansanam',
        namaPerpus: namaPerpus || 'Perpus Digital Smansanam',
        logo: logo || '📚',
        warna: warna || '#059669',
        deskripsi: deskripsi || 'Sistem perpustakaan digital'
      };

      try {
        await writeDataFile('settings.json', JSON.stringify(settingsData, null, 2), 'Update pengaturan');
        return sendJson(res, 200, { message: 'Pengaturan berhasil diperbarui.', settings: settingsData });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal memperbarui pengaturan.' });
      }
    }

    // ─── 404 ────────────────────────────────────────────────────────────
    return sendJson(res, 404, { message: 'Endpoint tidak ditemukan.' });
  } catch (err) {
    return sendJson(res, 500, { message: 'Terjadi kesalahan pada server.', error: String(err && err.message ? err.message : err) });
  }
}
