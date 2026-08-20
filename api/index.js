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
// BARCODE ANGGOTA: KODE UNIK PER PENGGUNA (AWALAN 2407) UNTUK ABSENSI SCAN
// DIBUAT OTOMATIS SAAT AKUN DIBUAT (REGISTRASI MANDIRI / DITAMBAHKAN ADMIN)
// ─────────────────────────────────────────────────────────────────────────
const BARCODE_PREFIX = '2407';

function generateKodeBarcode(existingBarcodes) {
  let kode;
  let percobaan = 0;
  do {
    const acak = crypto.randomInt(100000, 1000000).toString();
    kode = `${BARCODE_PREFIX}${acak}`;
    percobaan++;
  } while (existingBarcodes.has(kode) && percobaan < 50);
  return kode;
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
// GAMIFIKASI LITERASI: KOMPETISI DUTA LITERASI
// ─────────────────────────────────────────────────────────────────────────
function generatePeriodeId() {
  return `prd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function generateLoanId() {
  return `pjm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

// Klasifikasi jenis buku hanya menjadi 2 golongan besar untuk kompetisi Duta
// Buku: "Fiksi" (persis kategori Fiksi) dan "Non-Fiksi" (semua kategori lain,
// termasuk Non-Fiksi, Umum, Sains, Sejarah, Agama, Pelajaran, Biografi, dst).
function klasifikasiJenisBuku(kategori) {
  return String(kategori || '').trim().toLowerCase() === 'fiksi' ? 'Fiksi' : 'Non-Fiksi';
}

// Daftar kategori buku fisik yang boleh dipilih pengguna saat mengajukan
// peminjaman mandiri (dropdown di dashboard user).
const KATEGORI_BUKU_VALID = ['Fiksi', 'Non-Fiksi', 'Novel', 'Pelajaran', 'Kamus', 'Referensi', 'Umum'];

// Batas maksimal jangka waktu peminjaman buku fisik oleh pengguna (hari).
const MAX_JANGKA_HARI_PEMINJAMAN = 3;

function isValidTanggal(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

// Menambahkan sejumlah hari ke tanggal (format YYYY-MM-DD), mengembalikan
// tanggal baru dalam format yang sama. Dipakai untuk menghitung rencana
// tanggal pengembalian buku dari tanggal pinjam + jangka waktu (hari).
function tambahHari(tanggalStr, jumlahHari) {
  const [y, m, d] = tanggalStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + jumlahHari);
  return dt.toISOString().slice(0, 10);
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
// SOSMED SEKOLAH: DAFTAR DEFAULT (DIPAKAI JIKA settings.json BELUM PUNYA sosmed)
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_SOSMED = [
  { id: 'sosmed_instagram', platform: 'Instagram', icon: 'fa-brands fa-instagram', iconBg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4)', handle: '@smansanam.official', desc: 'Kegiatan & info harian sekolah', url: 'https://instagram.com/smansanam.official' },
  { id: 'sosmed_tiktok', platform: 'TikTok', icon: 'fa-brands fa-tiktok', iconBg: '#000000', handle: '@smansanam.official', desc: 'Konten kreatif seputar sekolah', url: 'https://tiktok.com/@smansanam.official' },
  { id: 'sosmed_youtube', platform: 'YouTube', icon: 'fa-brands fa-youtube', iconBg: 'linear-gradient(135deg,#ff0000,#b30000)', handle: 'SMA Negeri Sanam', desc: 'Dokumentasi & liputan acara', url: 'https://youtube.com/@smansanam' },
  { id: 'sosmed_facebook', platform: 'Facebook', icon: 'fa-brands fa-facebook-f', iconBg: 'linear-gradient(135deg,#1877f2,#0a58c2)', handle: 'SMA Negeri Sanam', desc: 'Pengumuman resmi sekolah', url: 'https://facebook.com/smansanam.official' },
  { id: 'sosmed_whatsapp', platform: 'WhatsApp', icon: 'fa-brands fa-whatsapp', iconBg: 'linear-gradient(135deg,#25d366,#128c7e)', handle: 'Kontak Tata Usaha', desc: 'Layanan informasi & administrasi', url: 'https://wa.me/6280000000000' },
  { id: 'sosmed_website', platform: 'Website', icon: 'fa-solid fa-globe', iconBg: 'linear-gradient(135deg,#059669,#065f46)', handle: 'smansanam.sch.id', desc: 'Portal resmi sekolah', url: '#' }
];

// Membersihkan & membatasi data sosmed yang dikirim admin agar aman disimpan.
function sanitizeSosmedList(rawList) {
  if (!Array.isArray(rawList)) return null;
  const bersih = rawList
    .slice(0, 20) // batas wajar jumlah kartu sosmed
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const platform = String(item.platform || '').trim().slice(0, 40);
      const url = String(item.url || '').trim().slice(0, 500);
      if (!platform || !url) return null;
      return {
        id: String(item.id || `sosmed_${Date.now()}_${idx}_${crypto.randomBytes(2).toString('hex')}`).slice(0, 60),
        platform,
        icon: String(item.icon || 'fa-solid fa-link').trim().slice(0, 60),
        iconBg: String(item.iconBg || '#059669').trim().slice(0, 120),
        handle: String(item.handle || '').trim().slice(0, 80),
        desc: String(item.desc || '').trim().slice(0, 140),
        url
      };
    })
    .filter(Boolean);
  return bersih;
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
// BACA FILE + SHA SEKALIGUS (DIPAKAI OLEH PENULISAN AMAN/ANTI-TABRAKAN)
// ─────────────────────────────────────────────────────────────────────────
async function getGitHubFileWithSha(relPath) {
  const branch = process.env.GITHUB_BRANCH || 'main';
  const response = await fetch(
    `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${relPath}?ref=${branch}&_=${Date.now()}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    }
  );
  if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
  const data = await response.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

// ─────────────────────────────────────────────────────────────────────────
// PENULISAN JSON YANG AMAN DARI TABRAKAN (RACE CONDITION)
// ─────────────────────────────────────────────────────────────────────────
// Masalah aslinya: writeDataFile() biasa membaca file SEKALI lalu menimpa
// dengan versi barunya. Kalau ada 2 orang memindai kartu barcode nyaris
// bersamaan (mis. antrean absen ramai), permintaan kedua bisa menimpa balik
// data attendance.json dengan versi yang belum memuat absensi orang pertama
// (SHA GitHub sudah berubah duluan) -> absensi "hilang" atau muncul error
// "Gagal menyimpan absensi" padahal barcode-nya valid.
//
// Fungsi ini membaca data TERBARU, menjalankan `mutateFn` untuk menghasilkan
// data baru, lalu mencoba menyimpannya. Jika GitHub menolak karena SHA sudah
// berubah (409 Conflict), data dibaca ulang dari awal dan `mutateFn`
// dijalankan lagi dengan data terbaru, sampai beberapa kali percobaan -
// sehingga absensi tidak pernah tertimpa atau hilang begitu saja.
//
// `mutateFn(currentJson)` harus mengembalikan salah satu:
//   - { data: objekBaru, ...lainnya }  -> lanjut disimpan
//   - { abort: true, ...lainnya }      -> batalkan penyimpanan (mis. sudah absen hari ini)
async function writeDataFileSafely(relPath, mutateFn, messageFn, maxAttempts = 5) {
  if (!githubConfigured()) {
    // Mode lokal/dev: tidak ada proses lain yang menulis bersamaan, jadi
    // baca-ubah-tulis langsung sudah cukup aman.
    const localPath = path.join(LOCAL_DATA_DIR, relPath);
    let currentJson = {};
    try { currentJson = JSON.parse(fs.readFileSync(localPath, 'utf-8')); } catch { currentJson = {}; }
    const outcome = mutateFn(currentJson);
    if (outcome.abort) return outcome;
    try { fs.writeFileSync(localPath, JSON.stringify(outcome.data, null, 2), 'utf-8'); } catch {}
    return outcome;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let currentJson = {};
    let sha = '';
    try {
      const file = await getGitHubFileWithSha(`data/${relPath}`);
      currentJson = JSON.parse(file.content);
      sha = file.sha;
    } catch {
      currentJson = {};
    }

    const outcome = mutateFn(currentJson);
    if (outcome.abort) return outcome;

    const updateResponse = await fetch(
      `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/data/${relPath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: messageFn ? messageFn(outcome) : `Update ${relPath}`,
          content: Buffer.from(JSON.stringify(outcome.data, null, 2)).toString('base64'),
          sha: sha || undefined,
          branch: process.env.GITHUB_BRANCH || 'main'
        })
      }
    );

    if (updateResponse.ok) return outcome;

    if (updateResponse.status === 409 && attempt < maxAttempts - 1) {
      // Tabrakan SHA: tunggu sebentar (dengan jeda makin panjang), lalu ambil
      // data terbaru & ulangi dari awal loop.
      await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 200));
      continue;
    }

    throw new Error(`Gagal menyimpan data: ${updateResponse.status}`);
  }
  throw new Error('Gagal menyimpan data setelah beberapa percobaan.');
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

      // ─── AKUN LAMA YANG BELUM PUNYA KODE BARCODE: BUAT SEKARANG (BACKFILL) ───
      if (!user.kodeBarcode) {
        const existingBarcodes = new Set(usersData.users.map((u) => u.kodeBarcode).filter(Boolean));
        user.kodeBarcode = generateKodeBarcode(existingBarcodes);
        try {
          await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Buat kode barcode: ${user.nama}`);
        } catch { /* best-effort, tidak menghalangi proses login */ }
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
      const existingBarcodes = new Set(usersData.users.map((u) => u.kodeBarcode).filter(Boolean));

      const newUser = {
        id: `usr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        nama: String(nama).trim(),
        status,
        kelas: status === 'siswa' ? String(kelas).trim() : null,
        jabatan: status !== 'siswa' ? (jabatan ? String(jabatan).trim() : '') : null,
        foto: null,
        kodeBarcode: generateKodeBarcode(existingBarcodes),
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

      const { currentPassword, newPassword, confirmNewPassword, foto, hapusFoto } = body;

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

      // ─── DATA IDENTITAS (NAMA, KELAS, JABATAN): HANYA ADMIN ───
      // Sengaja TIDAK menerima `nama`/`kelas`/`jabatan` dari endpoint ini lagi.
      // Perubahan data identitas sekarang cuma boleh lewat Panel Admin
      // (route users/... yang butuh token admin), supaya pengguna tidak bisa
      // mengubah nama/kelas/jabatan sendiri - baik lewat UI maupun dengan
      // memanggil API ini langsung.

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
        metode: 'qr',
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

    // ─── ABSEN KEHADIRAN VIA SCAN BARCODE KARTU ANGGOTA (1x PER HARI) ───
    // Dipakai di halaman index/login: petugas memindai barcode kartu
    // anggota memakai scanner fisik (USB HID, berperilaku seperti keyboard
    // + Enter). Tidak memerlukan sesi login — identitas pengguna didapat
    // langsung dari kecocokan kodeBarcode di data pengguna.
    if (method === 'POST' && route === 'attendance/barcode') {
      // Bersihkan hasil pindaian: kode barcode anggota selalu berupa digit
      // saja (awalan 2407 + 6 digit acak). Sebagian scanner USB (keyboard
      // wedge) kadang menyisipkan karakter/tab/whitespace ekstra di sekitar
      // hasil pindaian -> jika tidak dibersihkan, kode jadi tidak cocok
      // dengan data pengguna dan absensi selalu gagal walau kartunya valid.
      const kodeBarcode = String(body.kodeBarcode || '').replace(/[^0-9A-Za-z]/g, '').trim();
      const alasan = String(body.alasan || '').trim();

      if (!kodeBarcode) {
        return sendJson(res, 400, { message: 'Kode barcode tidak terbaca. Coba pindai ulang.' });
      }
      if (!alasan) {
        return sendJson(res, 400, { message: 'Alasan kunjungan wajib dipilih.' });
      }
      if (!ALASAN_KUNJUNGAN.includes(alasan)) {
        return sendJson(res, 400, { message: 'Alasan kunjungan tidak valid.' });
      }

      let usersData;
      try {
        usersData = JSON.parse(await readDataFile('users.json'));
      } catch {
        return sendJson(res, 500, { message: 'Data pengguna tidak dapat dimuat.' });
      }

      const user = (usersData.users || []).find((u) => u.kodeBarcode === kodeBarcode);
      if (!user) {
        return sendJson(res, 404, { message: 'Kode barcode tidak terdaftar. Pastikan kartu anggota valid.' });
      }

      const today = todayJakarta();

      // ─── SIMPAN ABSENSI DENGAN PERLINDUNGAN ANTI-TABRAKAN ───
      // Memakai writeDataFileSafely (bukan readDataFile+writeDataFile biasa)
      // supaya kalau ada beberapa siswa memindai kartu berurutan cepat,
      // absensi tidak saling menimpa/hilang dan tidak gagal tanpa alasan
      // hanya karena SHA file attendance.json berubah di tengah jalan.
      let outcome;
      try {
        outcome = await writeDataFileSafely(
          'attendance.json',
          (currentJson) => {
            const attendanceData = (currentJson && Array.isArray(currentJson.attendance))
              ? currentJson
              : { attendance: [] };

            const sudahAbsen = attendanceData.attendance.find(
              (a) => a.userId === user.id && a.tanggal === today
            );
            if (sudahAbsen) {
              return { abort: true, alreadyMarked: true };
            }

            const record = {
              id: generateAttendanceId(),
              userId: user.id,
              nama: user.nama,
              status: user.status,
              kelas: user.kelas || null,
              jabatan: user.jabatan || null,
              alasan,
              metode: 'barcode',
              tanggal: today,
              waktuAbsen: new Date().toISOString()
            };
            attendanceData.attendance.push(record);
            return { data: attendanceData, record };
          },
          (outcome) => `Absen barcode: ${outcome.record ? outcome.record.nama : user.nama}`
        );
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menyimpan absensi. Silakan coba lagi.' });
      }

      if (outcome.abort) {
        return sendJson(res, 400, { message: `${user.nama} sudah melakukan absensi hari ini.`, nama: user.nama });
      }

      return sendJson(res, 200, {
        message: 'Absensi berhasil dicatat.',
        nama: user.nama,
        status: user.status,
        kelas: user.kelas || null,
        jabatan: user.jabatan || null,
        foto: user.foto || null,
        record: outcome.record
      });
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
        jabatan: u.jabatan,
        kodeBarcode: u.kodeBarcode || null
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
      const existingBarcodes = new Set(usersData.users.map((u) => u.kodeBarcode).filter(Boolean));

      const newUser = {
        id: `user_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        nama,
        status,
        kelas: status === 'siswa' ? (kelas || '') : null,
        jabatan: status !== 'siswa' ? (jabatan || '') : null,
        kodeBarcode: generateKodeBarcode(existingBarcodes),
        salt,
        hash
      };

      usersData.users.push(newUser);
      try {
        await writeDataFile('users.json', JSON.stringify(usersData, null, 2), `Tambah pengguna: ${nama}`);
        return sendJson(res, 201, { message: 'Pengguna berhasil ditambahkan.', user: { id: newUser.id, nama, status, kelas: newUser.kelas, jabatan: newUser.jabatan, kodeBarcode: newUser.kodeBarcode } });
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
        kodeAbsenQRDiperbarui: null,
        sosmed: DEFAULT_SOSMED
      };
      try {
        const data = JSON.parse(await readDataFile('settings.json'));
        settingsData = { ...settingsData, ...data };
        if (!Array.isArray(settingsData.sosmed) || settingsData.sosmed.length === 0) {
          settingsData.sosmed = DEFAULT_SOSMED;
        }
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

      const { namaSekolah, namaPerpus, logo, warna, deskripsi, sosmed } = body;
      const sosmedBersih = sanitizeSosmedList(sosmed);
      const settingsData = {
        ...existing,
        namaSekolah: namaSekolah || existing.namaSekolah || 'SMA Negeri Smansanam',
        namaPerpus: namaPerpus || existing.namaPerpus || 'Perpus Digital Smansanam',
        logo: logo || existing.logo || '📚',
        warna: warna || existing.warna || '#059669',
        deskripsi: deskripsi !== undefined ? deskripsi : (existing.deskripsi || 'Sistem perpustakaan digital'),
        sosmed: sosmedBersih !== null ? sosmedBersih : (Array.isArray(existing.sosmed) ? existing.sosmed : DEFAULT_SOSMED)
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

    // ═══════════════════════════════════════════════════════════════════
    // GAMIFIKASI LITERASI: KOMPETISI DUTA LITERASI
    // ═══════════════════════════════════════════════════════════════════

    // ─── PERIODE KOMPETISI: LIST (PUBLIK) ───────────────────────────────
    if (method === 'GET' && route === 'competitions/periode') {
      let data = { periode: [] };
      try {
        data = JSON.parse(await readDataFile('competitions.json'));
        if (!Array.isArray(data.periode)) data.periode = [];
      } catch {}
      const daftar = [...data.periode].sort((a, b) => new Date(b.mulai) - new Date(a.mulai));
      return sendJson(res, 200, { periode: daftar });
    }

    // ─── PERIODE KOMPETISI: BUAT BARU (ADMIN) ───────────────────────────
    if (method === 'POST' && route === 'competitions/periode') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const { nama, mulai, selesai, status } = body;
      if (!nama || !String(nama).trim()) {
        return sendJson(res, 400, { message: 'Nama periode wajib diisi.' });
      }
      if (!isValidTanggal(mulai) || !isValidTanggal(selesai)) {
        return sendJson(res, 400, { message: 'Tanggal mulai dan selesai wajib diisi dengan format yang benar.' });
      }
      if (mulai > selesai) {
        return sendJson(res, 400, { message: 'Tanggal mulai tidak boleh setelah tanggal selesai.' });
      }

      let data = { periode: [] };
      try {
        data = JSON.parse(await readDataFile('competitions.json'));
        if (!Array.isArray(data.periode)) data.periode = [];
      } catch {
        data = { periode: [] };
      }

      const statusBaru = status === 'aktif' ? 'aktif' : 'nonaktif';
      // Hanya 1 periode yang boleh berstatus aktif dalam satu waktu.
      if (statusBaru === 'aktif') {
        data.periode = data.periode.map((p) => ({ ...p, status: 'nonaktif' }));
      }

      const newPeriode = {
        id: generatePeriodeId(),
        nama: String(nama).trim(),
        mulai,
        selesai,
        status: statusBaru,
        dibuat: new Date().toISOString(),
        diperbarui: new Date().toISOString()
      };

      data.periode.push(newPeriode);
      try {
        await writeDataFile('competitions.json', JSON.stringify(data, null, 2), `Tambah periode kompetisi: ${newPeriode.nama}`);
        return sendJson(res, 201, { message: 'Periode kompetisi berhasil dibuat.', periode: newPeriode });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal membuat periode kompetisi.' });
      }
    }

    // ─── PERIODE KOMPETISI: UPDATE (ADMIN) ──────────────────────────────
    if (method === 'PUT' && parts[1] === 'competitions' && parts[2] === 'periode' && parts[3]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const periodeId = parts[3];
      const { nama, mulai, selesai, status } = body;
      if (mulai && !isValidTanggal(mulai)) {
        return sendJson(res, 400, { message: 'Format tanggal mulai tidak valid.' });
      }
      if (selesai && !isValidTanggal(selesai)) {
        return sendJson(res, 400, { message: 'Format tanggal selesai tidak valid.' });
      }

      let data = { periode: [] };
      try {
        data = JSON.parse(await readDataFile('competitions.json'));
        if (!Array.isArray(data.periode)) data.periode = [];
      } catch {
        return sendJson(res, 500, { message: 'Data periode tidak dapat dimuat.' });
      }

      const idx = data.periode.findIndex((p) => p.id === periodeId);
      if (idx === -1) {
        return sendJson(res, 404, { message: 'Periode kompetisi tidak ditemukan.' });
      }

      const mulaiBaru = mulai || data.periode[idx].mulai;
      const selesaiBaru = selesai || data.periode[idx].selesai;
      if (mulaiBaru > selesaiBaru) {
        return sendJson(res, 400, { message: 'Tanggal mulai tidak boleh setelah tanggal selesai.' });
      }

      if (status === 'aktif') {
        data.periode = data.periode.map((p) => ({ ...p, status: p.id === periodeId ? p.status : 'nonaktif' }));
      }

      data.periode[idx] = {
        ...data.periode[idx],
        nama: nama ? String(nama).trim() : data.periode[idx].nama,
        mulai: mulaiBaru,
        selesai: selesaiBaru,
        status: status === 'aktif' || status === 'nonaktif' ? status : data.periode[idx].status,
        diperbarui: new Date().toISOString()
      };

      try {
        await writeDataFile('competitions.json', JSON.stringify(data, null, 2), `Update periode kompetisi: ${data.periode[idx].nama}`);
        return sendJson(res, 200, { message: 'Periode kompetisi berhasil diperbarui.', periode: data.periode[idx] });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal memperbarui periode kompetisi.' });
      }
    }

    // ─── PERIODE KOMPETISI: HAPUS (ADMIN) ───────────────────────────────
    if (method === 'DELETE' && parts[1] === 'competitions' && parts[2] === 'periode' && parts[3]) {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const periodeId = parts[3];
      let data = { periode: [] };
      try {
        data = JSON.parse(await readDataFile('competitions.json'));
        if (!Array.isArray(data.periode)) data.periode = [];
      } catch {
        return sendJson(res, 500, { message: 'Data periode tidak dapat dimuat.' });
      }

      const sebelum = data.periode.length;
      data.periode = data.periode.filter((p) => p.id !== periodeId);
      if (data.periode.length === sebelum) {
        return sendJson(res, 404, { message: 'Periode kompetisi tidak ditemukan.' });
      }

      try {
        await writeDataFile('competitions.json', JSON.stringify(data, null, 2), `Hapus periode kompetisi: ${periodeId}`);
        return sendJson(res, 200, { message: 'Periode kompetisi berhasil dihapus.' });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus periode kompetisi.' });
      }
    }

    // ─── PEMINJAMAN BUKU FISIK: LIST — ARUS PEMINJAMAN (ADMIN / STAF TU) ─
    if (method === 'GET' && route === 'loans') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      let loansData = { loans: [] };
      try {
        loansData = JSON.parse(await readDataFile('loans.json'));
        if (!Array.isArray(loansData.loans)) loansData.loans = [];
      } catch {}

      const reqUrl = new URL(`http://localhost${url}`);
      const q = (reqUrl.searchParams.get('q') || '').trim().toLowerCase();
      const jenis = reqUrl.searchParams.get('jenis');
      const statusPinjaman = reqUrl.searchParams.get('status');
      const periodeId = reqUrl.searchParams.get('periodeId');

      let hasil = loansData.loans;
      if (q) hasil = hasil.filter((l) => (l.nama || '').toLowerCase().includes(q) || (l.judulBuku || '').toLowerCase().includes(q));
      if (jenis && jenis !== 'semua') hasil = hasil.filter((l) => l.jenisBuku === jenis);
      if (statusPinjaman && statusPinjaman !== 'semua') {
        hasil = hasil.filter((l) => (l.statusPinjaman || 'dipinjam') === statusPinjaman);
      }

      if (periodeId) {
        let compData = { periode: [] };
        try {
          compData = JSON.parse(await readDataFile('competitions.json'));
          if (!Array.isArray(compData.periode)) compData.periode = [];
        } catch {}
        const periode = compData.periode.find((p) => p.id === periodeId);
        if (periode) {
          hasil = hasil.filter((l) => l.tanggalPinjam >= periode.mulai && l.tanggalPinjam <= periode.selesai);
        }
      }

      const today = todayJakarta();
      hasil = [...hasil]
        .sort((a, b) => new Date(b.dicatatPada) - new Date(a.dicatatPada))
        .map((l) => ({
          ...l,
          statusPinjaman: l.statusPinjaman || 'dipinjam',
          terlambat: (l.statusPinjaman || 'dipinjam') !== 'dikembalikan' && !!l.tanggalRencanaKembali && l.tanggalRencanaKembali < today
        }));

      return sendJson(res, 200, { total: hasil.length, data: hasil.slice(0, 500) });
    }

    // ─── PEMINJAMAN BUKU FISIK: RIWAYAT MILIK SENDIRI (SISWA/GURU/STAF) ─
    if (method === 'GET' && route === 'loans/mine') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin' || payload.role === 'tamu') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali sebagai anggota sekolah.' });
      }

      let loansData = { loans: [] };
      try {
        loansData = JSON.parse(await readDataFile('loans.json'));
        if (!Array.isArray(loansData.loans)) loansData.loans = [];
      } catch {}

      const today = todayJakarta();
      const milik = loansData.loans
        .filter((l) => l.userId === payload.sub)
        .map((l) => ({
          ...l,
          statusPinjaman: l.statusPinjaman || 'dipinjam',
          terlambat: (l.statusPinjaman || 'dipinjam') !== 'dikembalikan' && !!l.tanggalRencanaKembali && l.tanggalRencanaKembali < today
        }))
        .sort((a, b) => new Date(b.dicatatPada) - new Date(a.dicatatPada));

      return sendJson(res, 200, { data: milik });
    }

    // ─── PEMINJAMAN BUKU FISIK: AJUKAN PEMINJAMAN MANDIRI (SISWA/GURU/STAF) ─
    // Pengguna sendiri yang mengisi judul buku & jangka waktu peminjaman.
    // Admin tidak lagi mencatat manual — hanya memantau arus & detailnya.
    if (method === 'POST' && route === 'loans') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin' || payload.role === 'tamu') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali sebagai anggota sekolah.' });
      }

      const judulBuku = String(body.judulBuku || '').trim();
      const jangkaHari = parseInt(body.jangkaHari, 10);
      const catatan = body.catatan ? String(body.catatan).trim().slice(0, 200) : '';
      const kategoriInput = String(body.kategoriBuku || '').trim();

      if (!judulBuku) {
        return sendJson(res, 400, { message: 'Judul buku wajib diisi.' });
      }
      if (judulBuku.length > 150) {
        return sendJson(res, 400, { message: 'Judul buku maksimal 150 karakter.' });
      }
      if (!kategoriInput || !KATEGORI_BUKU_VALID.includes(kategoriInput)) {
        return sendJson(res, 400, { message: 'Kategori buku wajib dipilih dari daftar yang tersedia.' });
      }
      if (!Number.isInteger(jangkaHari) || jangkaHari < 1 || jangkaHari > MAX_JANGKA_HARI_PEMINJAMAN) {
        return sendJson(res, 400, { message: `Jangka waktu peminjaman maksimal ${MAX_JANGKA_HARI_PEMINJAMAN} hari.` });
      }

      // Kategori dipilih langsung oleh pengguna lewat dropdown. Jika judul buku
      // cocok dengan koleksi perpustakaan, gunakan kategori resmi koleksi tsb.
      let kategoriBuku = kategoriInput;
      try {
        const booksData = JSON.parse(await readDataFile('books.json'));
        const daftarBuku = Array.isArray(booksData.books) ? booksData.books : [];
        const cocok = daftarBuku.find((b) => (b.judul || '').trim().toLowerCase() === judulBuku.toLowerCase());
        if (cocok && cocok.kategori) kategoriBuku = cocok.kategori;
      } catch {}

      let loansData = { loans: [] };
      try {
        loansData = JSON.parse(await readDataFile('loans.json'));
        if (!Array.isArray(loansData.loans)) loansData.loans = [];
      } catch {
        loansData = { loans: [] };
      }

      const sudahDipinjamSerupa = loansData.loans.find(
        (l) => l.userId === payload.sub && (l.statusPinjaman || 'dipinjam') !== 'dikembalikan' &&
          l.judulBuku.trim().toLowerCase() === judulBuku.toLowerCase()
      );
      if (sudahDipinjamSerupa) {
        return sendJson(res, 409, { message: 'Kamu masih meminjam buku ini dan belum mengonfirmasi pengembaliannya.' });
      }

      const tanggalPinjam = todayJakarta();
      const tanggalRencanaKembali = tambahHari(tanggalPinjam, jangkaHari);

      const record = {
        id: generateLoanId(),
        userId: payload.sub,
        nama: payload.nama,
        status: payload.status || payload.role,
        kelas: payload.kelas || null,
        jabatan: payload.jabatan || null,
        judulBuku,
        kategoriBuku,
        jenisBuku: klasifikasiJenisBuku(kategoriBuku),
        tanggalPinjam,
        jangkaHari,
        tanggalRencanaKembali,
        statusPinjaman: 'dipinjam',
        tanggalDikembalikan: null,
        dikembalikanPada: null,
        catatan,
        dicatatPada: new Date().toISOString()
      };

      loansData.loans.push(record);
      try {
        await writeDataFile('loans.json', JSON.stringify(loansData, null, 2), `Peminjaman mandiri: ${payload.nama} - ${judulBuku}`);
        return sendJson(res, 201, { message: 'Peminjaman buku berhasil dikonfirmasi. Selamat membaca!', loan: record });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal mencatat peminjaman buku.' });
      }
    }

    // ─── PEMINJAMAN BUKU FISIK: ADMIN HAPUS SATU CATATAN ────────────────
    if (method === 'DELETE' && parts[1] === 'loans' && parts[2] && parts[2] !== 'reset') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const loanId = parts[2];
      let loansData = { loans: [] };
      try {
        loansData = JSON.parse(await readDataFile('loans.json'));
        if (!Array.isArray(loansData.loans)) loansData.loans = [];
      } catch {
        return sendJson(res, 500, { message: 'Data peminjaman tidak dapat dimuat.' });
      }

      const sebelum = loansData.loans.length;
      loansData.loans = loansData.loans.filter((l) => l.id !== loanId);
      if (loansData.loans.length === sebelum) {
        return sendJson(res, 404, { message: 'Catatan peminjaman tidak ditemukan.' });
      }

      try {
        await writeDataFile('loans.json', JSON.stringify(loansData, null, 2), `Admin hapus catatan peminjaman: ${loanId}`);
        return sendJson(res, 200, { message: 'Catatan peminjaman berhasil dihapus.' });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus catatan peminjaman.' });
      }
    }

    // ─── PEMINJAMAN BUKU FISIK: ADMIN HAPUS BEBERAPA CATATAN TERPILIH ───
    if (method === 'POST' && route === 'loans/bulk-delete') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
      if (ids.length === 0) {
        return sendJson(res, 400, { message: 'Tidak ada catatan yang dipilih untuk dihapus.' });
      }

      let loansData = { loans: [] };
      try {
        loansData = JSON.parse(await readDataFile('loans.json'));
        if (!Array.isArray(loansData.loans)) loansData.loans = [];
      } catch {
        return sendJson(res, 500, { message: 'Data peminjaman tidak dapat dimuat.' });
      }

      const idSet = new Set(ids);
      const sebelum = loansData.loans.length;
      loansData.loans = loansData.loans.filter((l) => !idSet.has(l.id));
      const dihapus = sebelum - loansData.loans.length;

      if (dihapus === 0) {
        return sendJson(res, 404, { message: 'Catatan peminjaman yang dipilih tidak ditemukan.' });
      }

      try {
        await writeDataFile('loans.json', JSON.stringify(loansData, null, 2), `Admin hapus ${dihapus} catatan peminjaman terpilih`);
        return sendJson(res, 200, { message: `${dihapus} catatan peminjaman berhasil dihapus.` });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal menghapus catatan peminjaman terpilih.' });
      }
    }

    // ─── PEMINJAMAN BUKU FISIK: ADMIN RESET SELURUH DATA ────────────────
    if (method === 'POST' && route === 'loans/reset') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      try {
        await writeDataFile('loans.json', JSON.stringify({ loans: [] }, null, 2), `Admin reset seluruh data peminjaman`);
        return sendJson(res, 200, { message: 'Seluruh data peminjaman berhasil direset.' });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal mereset data peminjaman.' });
      }
    }

    // ─── PENGATURAN: RESET DATA JSON (ZONA BERBAHAYA) ───────────────────
    // Reset satu atau beberapa dataset sekaligus dari halaman Pengaturan admin.
    // Sengaja TIDAK menyediakan reset untuk admin.json (akun admin) & settings.json
    // (konfigurasi situs) supaya admin tidak bisa mengunci diri sendiri keluar sistem.
    const RESET_DATA_TARGETS = {
      books: { file: 'books.json', empty: { books: [] }, label: 'Koleksi Buku' },
      users: { file: 'users.json', empty: { users: [] }, label: 'Pengguna (Siswa/Guru/Staf)' },
      attendance: { file: 'attendance.json', empty: { attendance: [] }, label: 'Absensi Kehadiran' },
      guests: { file: 'guests.json', empty: { guests: [] }, label: 'Data Tamu' },
      reading: { file: 'reading.json', empty: { sessions: [] }, label: 'Tracking Pembaca' },
      loans: { file: 'loans.json', empty: { loans: [] }, label: 'Peminjaman Buku' },
      competitions: { file: 'competitions.json', empty: { periode: [] }, label: 'Kompetisi Duta Literasi' }
    };

    if (method === 'GET' && route === 'settings/reset-data') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }
      const daftar = Object.entries(RESET_DATA_TARGETS).map(([key, v]) => ({ key, label: v.label }));
      return sendJson(res, 200, { data: daftar });
    }

    if (method === 'POST' && route === 'settings/reset-data') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || payload.role !== 'admin') {
        return sendJson(res, 401, { message: 'Akses ditolak. Khusus admin.' });
      }

      const targets = Array.isArray(body.targets) ? body.targets.filter((t) => typeof t === 'string') : [];
      const valid = targets.filter((t) => RESET_DATA_TARGETS[t]);
      if (valid.length === 0) {
        return sendJson(res, 400, { message: 'Tidak ada dataset valid yang dipilih untuk direset.' });
      }

      const berhasil = [];
      const gagal = [];
      for (const key of valid) {
        const target = RESET_DATA_TARGETS[key];
        try {
          await writeDataFile(target.file, JSON.stringify(target.empty, null, 2), `Admin reset dataset: ${target.label}`);
          berhasil.push(target.label);
        } catch (err) {
          gagal.push(target.label);
        }
      }

      if (berhasil.length === 0) {
        return sendJson(res, 500, { message: 'Gagal mereset dataset yang dipilih.' });
      }
      const pesan = gagal.length > 0
        ? `Berhasil reset: ${berhasil.join(', ')}. Gagal: ${gagal.join(', ')}.`
        : `Berhasil mereset: ${berhasil.join(', ')}.`;
      return sendJson(res, 200, { message: pesan, berhasil, gagal });
    }

    // ─── PEMINJAMAN BUKU FISIK: KONFIRMASI PENGEMBALIAN MANDIRI ─────────
    if (method === 'POST' && parts[1] === 'loans' && parts[2] && parts[3] === 'kembalikan') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'admin' || payload.role === 'tamu') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali sebagai anggota sekolah.' });
      }

      const loanId = parts[2];
      let loansData = { loans: [] };
      try {
        loansData = JSON.parse(await readDataFile('loans.json'));
        if (!Array.isArray(loansData.loans)) loansData.loans = [];
      } catch {
        return sendJson(res, 500, { message: 'Data peminjaman tidak dapat dimuat.' });
      }

      const idx = loansData.loans.findIndex((l) => l.id === loanId && l.userId === payload.sub);
      if (idx === -1) {
        return sendJson(res, 404, { message: 'Catatan peminjaman tidak ditemukan.' });
      }
      if ((loansData.loans[idx].statusPinjaman || 'dipinjam') === 'dikembalikan') {
        return sendJson(res, 200, { message: 'Buku ini sudah tercatat dikembalikan sebelumnya.', loan: loansData.loans[idx] });
      }

      const now = new Date();
      loansData.loans[idx] = {
        ...loansData.loans[idx],
        statusPinjaman: 'dikembalikan',
        tanggalDikembalikan: todayJakarta(),
        dikembalikanPada: now.toISOString()
      };

      try {
        await writeDataFile('loans.json', JSON.stringify(loansData, null, 2), `Pengembalian buku: ${loansData.loans[idx].nama} - ${loansData.loans[idx].judulBuku}`);
        return sendJson(res, 200, { message: 'Pengembalian buku berhasil dikonfirmasi. Terima kasih!', loan: loansData.loans[idx] });
      } catch (err) {
        return sendJson(res, 500, { message: 'Gagal mencatat pengembalian buku.' });
      }
    }

    // ─── PERINGKAT KOMPETISI: DUTA LITERASI, DUTA KUNJUNGAN, DUTA BUKU ──
    if (method === 'GET' && route === 'competitions/ranking') {
      const token = getBearerToken(headers);
      const payload = token ? verifyToken(token) : null;
      if (!payload || !payload.role || payload.role === 'tamu') {
        return sendJson(res, 401, { message: 'Sesi tidak valid. Silakan login kembali sebagai anggota sekolah.' });
      }

      let compData = { periode: [] };
      try {
        compData = JSON.parse(await readDataFile('competitions.json'));
        if (!Array.isArray(compData.periode)) compData.periode = [];
      } catch {}

      const reqUrl = new URL(`http://localhost${url}`);
      const periodeIdParam = reqUrl.searchParams.get('periodeId');
      const daftarPeriode = [...compData.periode].sort((a, b) => new Date(b.mulai) - new Date(a.mulai));

      let periodeAktif = null;
      if (periodeIdParam) {
        periodeAktif = daftarPeriode.find((p) => p.id === periodeIdParam) || null;
      }
      if (!periodeAktif) {
        const today = todayJakarta();
        periodeAktif =
          daftarPeriode.find((p) => p.status === 'aktif' && today >= p.mulai && today <= p.selesai) ||
          daftarPeriode.find((p) => p.status === 'aktif') ||
          daftarPeriode[0] ||
          null;
      }

      if (!periodeAktif) {
        return sendJson(res, 200, {
          periode: null,
          daftarPeriode: [],
          message: 'Belum ada periode kompetisi yang diatur oleh admin.',
          dutaLiterasi: { leaderboard: [], totalPeserta: 0 },
          dutaKunjungan: { leaderboard: [], totalPeserta: 0 },
          dutaBuku: {
            semua: { leaderboard: [], totalPeserta: 0 },
            fiksi: { leaderboard: [], totalPeserta: 0 },
            nonFiksi: { leaderboard: [], totalPeserta: 0 }
          },
          saya: { literasi: null, kunjungan: null, bukuSemua: null, bukuFiksi: null, bukuNonFiksi: null }
        });
      }

      const { mulai, selesai } = periodeAktif;

      function bangunPeringkat(map, valueKey) {
        const arr = Object.values(map).sort((a, b) => b[valueKey] - a[valueKey]);
        arr.forEach((item, i) => { item.rank = i + 1; });
        return arr;
      }
      function ambilMilikSaya(arr) {
        const found = arr.find((item) => item.userId === payload.sub);
        return found ? { rank: found.rank, nilai: found[Object.keys(found).find(k => k.startsWith('total'))] } : null;
      }

      // ── Duta Literasi (total durasi membaca) ──
      let literasiMap = {};
      try {
        const readingData = JSON.parse(await readDataFile('reading.json'));
        const sessions = Array.isArray(readingData.sessions) ? readingData.sessions : [];
        const now = Date.now();
        sessions.forEach((s) => {
          if (!s.tanggal || s.tanggal < mulai || s.tanggal > selesai) return;
          if (!s.status || s.status === 'tamu') return;
          const durasi = hitungDurasiEfektif(s, now);
          if (!literasiMap[s.userId]) {
            literasiMap[s.userId] = { userId: s.userId, nama: s.nama, status: s.status, kelas: s.kelas || null, jabatan: s.jabatan || null, totalDetik: 0 };
          }
          literasiMap[s.userId].totalDetik += durasi;
        });
      } catch {}
      const literasiLeaderboard = bangunPeringkat(literasiMap, 'totalDetik');

      // ── Duta Kunjungan (jumlah kunjungan / absensi) ──
      let kunjunganMap = {};
      try {
        const attendanceData = JSON.parse(await readDataFile('attendance.json'));
        const list = Array.isArray(attendanceData.attendance) ? attendanceData.attendance : [];
        list.forEach((a) => {
          if (!a.tanggal || a.tanggal < mulai || a.tanggal > selesai) return;
          if (!a.status || a.status === 'tamu') return;
          if (!kunjunganMap[a.userId]) {
            kunjunganMap[a.userId] = { userId: a.userId, nama: a.nama, status: a.status, kelas: a.kelas || null, jabatan: a.jabatan || null, totalKunjungan: 0 };
          }
          kunjunganMap[a.userId].totalKunjungan += 1;
        });
      } catch {}
      const kunjunganLeaderboard = bangunPeringkat(kunjunganMap, 'totalKunjungan');

      // ── Duta Buku (jumlah peminjaman buku fisik, per kategori) ──
      let bukuSemuaMap = {}, bukuFiksiMap = {}, bukuNonFiksiMap = {};
      try {
        const loansData = JSON.parse(await readDataFile('loans.json'));
        const loans = Array.isArray(loansData.loans) ? loansData.loans : [];
        loans.forEach((l) => {
          if (!l.tanggalPinjam || l.tanggalPinjam < mulai || l.tanggalPinjam > selesai) return;
          const base = { userId: l.userId, nama: l.nama, status: l.status, kelas: l.kelas || null, jabatan: l.jabatan || null };

          if (!bukuSemuaMap[l.userId]) bukuSemuaMap[l.userId] = { ...base, totalPinjam: 0 };
          bukuSemuaMap[l.userId].totalPinjam += 1;

          const jenis = l.jenisBuku === 'Fiksi' ? 'Fiksi' : 'Non-Fiksi';
          if (jenis === 'Fiksi') {
            if (!bukuFiksiMap[l.userId]) bukuFiksiMap[l.userId] = { ...base, totalPinjam: 0 };
            bukuFiksiMap[l.userId].totalPinjam += 1;
          } else {
            if (!bukuNonFiksiMap[l.userId]) bukuNonFiksiMap[l.userId] = { ...base, totalPinjam: 0 };
            bukuNonFiksiMap[l.userId].totalPinjam += 1;
          }
        });
      } catch {}
      const bukuSemuaLeaderboard = bangunPeringkat(bukuSemuaMap, 'totalPinjam');
      const bukuFiksiLeaderboard = bangunPeringkat(bukuFiksiMap, 'totalPinjam');
      const bukuNonFiksiLeaderboard = bangunPeringkat(bukuNonFiksiMap, 'totalPinjam');

      return sendJson(res, 200, {
        periode: periodeAktif,
        daftarPeriode,
        dutaLiterasi: { leaderboard: literasiLeaderboard.slice(0, 20), totalPeserta: literasiLeaderboard.length },
        dutaKunjungan: { leaderboard: kunjunganLeaderboard.slice(0, 20), totalPeserta: kunjunganLeaderboard.length },
        dutaBuku: {
          semua: { leaderboard: bukuSemuaLeaderboard.slice(0, 20), totalPeserta: bukuSemuaLeaderboard.length },
          fiksi: { leaderboard: bukuFiksiLeaderboard.slice(0, 20), totalPeserta: bukuFiksiLeaderboard.length },
          nonFiksi: { leaderboard: bukuNonFiksiLeaderboard.slice(0, 20), totalPeserta: bukuNonFiksiLeaderboard.length }
        },
        saya: {
          literasi: ambilMilikSaya(literasiLeaderboard),
          kunjungan: ambilMilikSaya(kunjunganLeaderboard),
          bukuSemua: ambilMilikSaya(bukuSemuaLeaderboard),
          bukuFiksi: ambilMilikSaya(bukuFiksiLeaderboard),
          bukuNonFiksi: ambilMilikSaya(bukuNonFiksiLeaderboard)
        }
      });
    }

    // ─── 404 ────────────────────────────────────────────────────────────
    return sendJson(res, 404, { message: 'Endpoint tidak ditemukan.' });
  } catch (err) {
    return sendJson(res, 500, { message: 'Terjadi kesalahan pada server.', error: String(err && err.message ? err.message : err) });
  }
}
