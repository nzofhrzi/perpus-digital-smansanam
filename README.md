# 📚 Perpus Digital Smansanam

Sistem Perpustakaan Digital Online — tahap awal: **autentikasi & navigasi dashboard**.

Dibangun dengan arsitektur *serverless* (Vercel Functions) + penyimpanan data via **GitHub API** (agar data tetap tersimpan permanen meski *filesystem* Vercel bersifat *read-only*), mengikuti pola proyek referensi sebelumnya.

## ✨ Fitur pada tahap ini

- Login **Anggota Sekolah** (Siswa / Guru / Staf) — nama, status/jabatan, kelas (khusus siswa), password.
- Login **Tamu** — nama, jabatan/keperluan, umur (tanpa password), otomatis tercatat sebagai log kunjungan.
- Login **Administrator** — username & password, tersembunyi di balik tombol "Masuk sebagai Administrator".
- Dashboard publik (anggota/tamu) dengan sidebar: Beranda, Absensi Kehadiran, Baca Buku Online, Tracking Pembaca, Profil Saya — modul-modul selain Beranda & Profil masih berupa *placeholder* ("segera hadir").
- Admin Panel dengan sidebar: Dashboard, Kelola Buku, Kelola Pengguna, Kelola Absensi, Tracking Pembaca, Pengaturan — statistik dasar sudah tersambung ke API, modul CRUD masih *placeholder*.
- Sesi login memakai token JWT sederhana (HMAC-SHA256), disimpan di `localStorage`, tervalidasi ulang ke server tiap dashboard dibuka.

## 🗂️ Struktur Proyek

```
perpus-digital-smansanam/
├── api/
│   └── index.js          # Seluruh endpoint API (serverless function)
├── data/
│   ├── users.json        # Akun siswa/guru/staf (password ter-hash)
│   ├── admin.json        # Akun admin (password ter-hash)
│   ├── guests.json       # Log kunjungan tamu (terisi otomatis)
│   ├── books.json        # Placeholder koleksi buku
│   └── attendance.json   # Placeholder data absensi
├── public/
│   ├── index.html         # Halaman login (Anggota / Tamu / Admin)
│   ├── dashboard.html      # Dashboard publik anggota & tamu
│   └── admin.html          # Admin panel
├── package.json
├── vercel.json
└── .env.example
```

## 🔑 Akun Demo

| Peran  | Nama / Username               | Kelas       | Password   |
|--------|--------------------------------|-------------|------------|
| Siswa  | Ahmad Fauzan Ramadhan           | XII IPA 1   | siswa123   |
| Guru   | Siti Rahma, S.Pd                | —           | guru123    |
| Staf   | Budi Santoso                    | —           | staf123    |
| Tamu   | *(isi bebas, tanpa password)*   | —           | —          |
| Admin  | admin                           | —           | admin123   |

## 🚀 Setup & Deploy

1. **Push proyek ini ke repository GitHub Anda.**

2. **Buat Personal Access Token GitHub** (scope `repo`) untuk mengizinkan API menulis data (log tamu, dsb) langsung ke repo.

3. **Deploy ke Vercel** dan atur Environment Variables (lihat `.env.example`):
   - `GITHUB_TOKEN` — personal access token GitHub
   - `GITHUB_OWNER` — username GitHub Anda
   - `GITHUB_REPO` — nama repository ini
   - `GITHUB_BRANCH` — branch aktif (default `main`)
   - `JWT_SECRET` — string rahasia acak untuk menandatangani token

   > Jika variabel GitHub belum diatur (mis. saat `vercel dev` / pengujian lokal), API otomatis membaca & menulis ke folder `data/` secara lokal sebagai *fallback*.

4. **Jalankan secara lokal (opsional):**
   ```bash
   npm install -g vercel
   vercel dev
   ```
   Buka `http://localhost:3000`.

## 🔒 Mengubah Password Akun

Password disimpan dalam bentuk *hash* (`scrypt`) di `data/users.json` / `data/admin.json`, bukan teks polos. Untuk menambah/mengubah akun, buat hash baru terlebih dahulu, misalnya lewat Node.js:

```js
import crypto from 'crypto';
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync('password_baru', salt, 64).toString('hex');
console.log({ salt, hash });
```

Lalu tempelkan `salt` & `hash` tersebut ke entri akun terkait di file JSON data.

## 🧭 Rencana Pengembangan Selanjutnya

- [ ] CRUD Kelola Buku (unggah PDF, tampil-saja/tanpa unduh, kategori & sampul)
- [ ] Modul Absensi Kehadiran (check-in/out, riwayat, rekap admin)
- [ ] Modul Baca Buku Online (pembaca PDF terkunci, progres baca)
- [ ] Tracking Pembaca (statistik individu & agregat, buku terpopuler)
- [ ] CRUD Kelola Pengguna dari Admin Panel (tanpa perlu edit file JSON manual)
- [ ] Pengaturan identitas perpustakaan (logo, nama, dsb.)

## 🎨 Identitas Visual

- Nama: **Perpus Digital Smansanam**
- Warna aksen: Hijau (`#059669`–`#052e21`) & Putih, teks hitam bila diperlukan kontras
- Ikon: Font Awesome 6 (bukan emoji standar)
- Font: Poppins (judul) & Plus Jakarta Sans (isi)
