-- =============================================================================
--  Skema basis data — Website PK PMII UIN SGD Cab. Kab. Bandung
--  Dialek: SQLite (untuk pengembangan). Catatan padanan MySQL/PostgreSQL
--  tersedia di docs/BACKEND-SPEC.md bagian 3.
--
--  Konvensi:
--   * Nama tabel jamak, snake_case.
--   * Waktu disimpan sebagai TEXT ISO-8601 UTC (SQLite tidak punya tipe waktu).
--   * Hapus data memakai kolom deleted_at (soft delete) untuk entitas konten.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. Pengguna internal (pengurus/admin CMS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  -- superadmin: seluruh akses | editor: konten | advokat: pengaduan
  -- panitia_mapaba: pendaftaran | panitia_cbt: bank soal & sesi ujian
  role          TEXT    NOT NULL DEFAULT 'editor'
                CHECK (role IN ('superadmin','editor','advokat','panitia_mapaba','panitia_cbt')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 2. Profil organisasi: pengurus & periode kepengurusan
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS periode (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL UNIQUE,          -- mis. "2025-2026"
  mulai      TEXT NOT NULL,
  selesai    TEXT NOT NULL,
  is_aktif   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pengurus (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  periode_id  INTEGER NOT NULL REFERENCES periode(id) ON DELETE CASCADE,
  nama        TEXT    NOT NULL,
  jabatan     TEXT    NOT NULL,
  bidang      TEXT,
  foto_url    TEXT,
  urutan      INTEGER NOT NULL DEFAULT 0,   -- untuk pengurutan tampilan
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pengurus_periode ON pengurus(periode_id, urutan);

-- -----------------------------------------------------------------------------
-- 3. CMS Artikel
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kategori (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nama  TEXT NOT NULL UNIQUE,              -- Berita, Opini, Kajian, Sastra
  slug  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS artikel (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  judul         TEXT    NOT NULL,
  ringkasan     TEXT    NOT NULL,           -- teks preview pada kartu
  konten        TEXT    NOT NULL,           -- HTML/Markdown hasil editor
  cover_url     TEXT,
  kategori_id   INTEGER REFERENCES kategori(id) ON DELETE SET NULL,
  penulis_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  penulis_nama  TEXT,                       -- untuk penulis tamu (non-user)
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','review','published','archived')),
  is_unggulan   INTEGER NOT NULL DEFAULT 0,
  dilihat       INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_artikel_publik   ON artikel(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_artikel_kategori ON artikel(kategori_id, published_at DESC);

CREATE TABLE IF NOT EXISTS tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS artikel_tag (
  artikel_id INTEGER NOT NULL REFERENCES artikel(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tag(id)     ON DELETE CASCADE,
  PRIMARY KEY (artikel_id, tag_id)
);

-- -----------------------------------------------------------------------------
-- 4. Galeri kegiatan
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS galeri_album (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  judul       TEXT    NOT NULL,
  deskripsi   TEXT,
  kategori    TEXT,                          -- MAPABA, Kajian, Aksi, Pengabdian
  tanggal     TEXT    NOT NULL,
  cover_url   TEXT,
  is_publik   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS galeri_media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id   INTEGER NOT NULL REFERENCES galeri_album(id) ON DELETE CASCADE,
  tipe       TEXT    NOT NULL DEFAULT 'foto' CHECK (tipe IN ('foto','video')),
  url        TEXT    NOT NULL,
  thumb_url  TEXT,
  caption    TEXT,
  urutan     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_galeri_media_album ON galeri_media(album_id, urutan);

-- -----------------------------------------------------------------------------
-- 5. Landasan hukum / dokumen resmi
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dokumen (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  judul       TEXT    NOT NULL,
  deskripsi   TEXT,
  kategori    TEXT    NOT NULL DEFAULT 'konstitusi'
              CHECK (kategori IN ('konstitusi','ndp','peraturan','kaderisasi','lainnya')),
  file_url    TEXT    NOT NULL,
  mime        TEXT,
  ukuran_byte INTEGER,
  tahun       INTEGER,
  urutan      INTEGER NOT NULL DEFAULT 0,
  diunduh     INTEGER NOT NULL DEFAULT 0,
  is_publik   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 6. Layanan Advokasi — pengaduan
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pengaduan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_tiket   TEXT    NOT NULL UNIQUE,     -- ADV-2026-0001
  nama          TEXT    NOT NULL,
  kontak        TEXT    NOT NULL,
  email         TEXT,
  status_pelapor TEXT   NOT NULL
                CHECK (status_pelapor IN ('mahasiswa','alumni','kader','masyarakat')),
  kategori      TEXT    NOT NULL
                CHECK (kategori IN ('akademik','fasilitas','kekerasan_seksual','ukt','perundungan',
                                    'kebebasan_berpendapat','ketenagakerjaan','lainnya')),
  kronologi     TEXT    NOT NULL,
  lampiran_url  TEXT,
  is_anonim     INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'baru'
                CHECK (status IN ('baru','verifikasi','pendampingan','selesai','ditolak')),
  prioritas     TEXT    NOT NULL DEFAULT 'normal'
                CHECK (prioritas IN ('rendah','normal','tinggi','darurat')),
  petugas_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  catatan_internal TEXT,
  ip_hash       TEXT,                        -- hash IP untuk anti-spam, bukan IP mentah
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_pengaduan_status ON pengaduan(status, created_at DESC);

-- Jejak audit perubahan status pengaduan
CREATE TABLE IF NOT EXISTS pengaduan_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pengaduan_id INTEGER NOT NULL REFERENCES pengaduan(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_lama  TEXT,
  status_baru  TEXT    NOT NULL,
  catatan      TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 7. MAPABA Raya — gelombang & pendaftar
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mapaba_gelombang (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT    NOT NULL,            -- "MAPABA Raya 2026"
  tahun         INTEGER NOT NULL,
  buka_at       TEXT    NOT NULL,
  tutup_at      TEXT    NOT NULL,
  mulai_acara   TEXT,
  selesai_acara TEXT,
  lokasi        TEXT,
  kuota         INTEGER NOT NULL DEFAULT 150,
  biaya         INTEGER NOT NULL DEFAULT 75000,
  is_aktif      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mapaba_pendaftar (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_registrasi  TEXT    NOT NULL UNIQUE, -- MPB-2026-0001
  gelombang_id      INTEGER NOT NULL REFERENCES mapaba_gelombang(id) ON DELETE CASCADE,
  nama_lengkap      TEXT    NOT NULL,
  nim               TEXT    NOT NULL,
  angkatan          INTEGER NOT NULL,
  universitas       TEXT    NOT NULL DEFAULT 'UIN Sunan Gunung Djati Bandung',
  fakultas          TEXT    NOT NULL,
  prodi             TEXT    NOT NULL,
  jenis_kelamin     TEXT    NOT NULL CHECK (jenis_kelamin IN ('L','P')),
  whatsapp          TEXT    NOT NULL,
  email             TEXT    NOT NULL,
  asal_daerah       TEXT,
  motivasi          TEXT    NOT NULL,
  riwayat_organisasi TEXT,
  sumber_informasi  TEXT,
  -- URL berkas hasil unggah (lihat routes/upload.js). Disimpan sebagai URL, bukan
  -- BLOB, agar berkas dapat dipindah ke object storage tanpa mengubah skema.
  pas_foto_url      TEXT,
  ktm_url           TEXT,
  bukti_bayar_url   TEXT,
  status            TEXT    NOT NULL DEFAULT 'menunggu'
                    CHECK (status IN ('menunggu','terverifikasi','hadir','ditolak','batal')),
  catatan_panitia   TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Satu NIM hanya boleh mendaftar sekali per gelombang
  UNIQUE (gelombang_id, nim)
);

CREATE INDEX IF NOT EXISTS idx_mapaba_status ON mapaba_pendaftar(gelombang_id, status);

-- -----------------------------------------------------------------------------
-- 8. CBT BIMTES — peserta, bank soal, sesi ujian, hasil
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cbt_peserta (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_peserta  TEXT    NOT NULL UNIQUE,    -- BIM-2026-0001 (dipakai untuk login)
  nama           TEXT    NOT NULL,
  email          TEXT    UNIQUE,
  whatsapp       TEXT,
  asal_sekolah   TEXT,
  password_hash  TEXT    NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1,
  gagal_login    INTEGER NOT NULL DEFAULT 0, -- untuk penguncian sementara
  locked_until   TEXT,
  last_login_at  TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cbt_paket (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kode             TEXT    NOT NULL UNIQUE,  -- TPS-2026-01
  nama             TEXT    NOT NULL,
  deskripsi        TEXT,
  durasi_menit     INTEGER NOT NULL,
  jumlah_soal      INTEGER NOT NULL,
  acak_soal        INTEGER NOT NULL DEFAULT 1,
  acak_opsi        INTEGER NOT NULL DEFAULT 1,
  max_percobaan    INTEGER NOT NULL DEFAULT 1,
  tampilkan_pembahasan INTEGER NOT NULL DEFAULT 1,
  buka_at          TEXT,
  tutup_at         TEXT,
  is_aktif         INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cbt_soal (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paket_id    INTEGER NOT NULL REFERENCES cbt_paket(id) ON DELETE CASCADE,
  subtes      TEXT,                          -- Penalaran Umum, Literasi, dsb.
  tipe        TEXT    NOT NULL DEFAULT 'pilihan_ganda'
              CHECK (tipe IN ('pilihan_ganda','benar_salah','isian_singkat')),
  pertanyaan  TEXT    NOT NULL,
  gambar_url  TEXT,
  pembahasan  TEXT,
  bobot       REAL    NOT NULL DEFAULT 1,
  urutan      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cbt_soal_paket ON cbt_soal(paket_id, urutan);

CREATE TABLE IF NOT EXISTS cbt_opsi (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  soal_id    INTEGER NOT NULL REFERENCES cbt_soal(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,               -- A, B, C, D, E
  teks       TEXT    NOT NULL,
  gambar_url TEXT,
  is_benar   INTEGER NOT NULL DEFAULT 0      -- JANGAN pernah dikirim ke klien saat ujian
);

CREATE INDEX IF NOT EXISTS idx_cbt_opsi_soal ON cbt_opsi(soal_id);

-- Satu sesi = satu percobaan pengerjaan oleh satu peserta
CREATE TABLE IF NOT EXISTS cbt_sesi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  peserta_id    INTEGER NOT NULL REFERENCES cbt_peserta(id) ON DELETE CASCADE,
  paket_id      INTEGER NOT NULL REFERENCES cbt_paket(id)   ON DELETE CASCADE,
  percobaan     INTEGER NOT NULL DEFAULT 1,
  -- Urutan soal & opsi hasil pengacakan, disimpan agar konsisten saat refresh
  urutan_soal   TEXT,                        -- JSON array id soal
  mulai_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Batas waktu dihitung di server: mulai_at + durasi_menit
  deadline_at   TEXT    NOT NULL,
  submit_at     TEXT,
  status        TEXT    NOT NULL DEFAULT 'berjalan'
                CHECK (status IN ('berjalan','selesai','kedaluwarsa','diskualifikasi')),
  skor          REAL,
  jumlah_benar  INTEGER,
  jumlah_salah  INTEGER,
  jumlah_kosong INTEGER,
  device_hash   TEXT,                        -- mengunci sesi pada satu perangkat
  UNIQUE (peserta_id, paket_id, percobaan)
);

CREATE INDEX IF NOT EXISTS idx_cbt_sesi_peserta ON cbt_sesi(peserta_id, status);

CREATE TABLE IF NOT EXISTS cbt_jawaban (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sesi_id     INTEGER NOT NULL REFERENCES cbt_sesi(id) ON DELETE CASCADE,
  soal_id     INTEGER NOT NULL REFERENCES cbt_soal(id) ON DELETE CASCADE,
  opsi_id     INTEGER REFERENCES cbt_opsi(id) ON DELETE SET NULL,
  teks_isian  TEXT,
  ragu        INTEGER NOT NULL DEFAULT 0,    -- tanda "ragu-ragu" pada navigasi soal
  is_benar    INTEGER,                       -- diisi saat penilaian
  answered_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (sesi_id, soal_id)                  -- autosave = UPSERT per soal
);

-- -----------------------------------------------------------------------------
-- 9. Utilitas: penomoran tiket/registrasi & jejak audit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  nama       TEXT    NOT NULL,               -- 'advokasi' | 'mapaba' | 'cbt'
  tahun      INTEGER NOT NULL,
  nilai      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (nama, tahun)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  aksi       TEXT    NOT NULL,               -- 'pengaduan.update_status'
  entitas    TEXT,                           -- 'pengaduan'
  entitas_id INTEGER,
  metadata   TEXT,                           -- JSON
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  kunci TEXT PRIMARY KEY,
  nilai TEXT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 10. Berkas unggahan & log notifikasi keluar
-- -----------------------------------------------------------------------------

-- Katalog seluruh berkas yang diunggah (pas foto, KTM, cover artikel, foto galeri).
-- Tabel ini membuat berkas yatim (tidak dipakai entitas mana pun) mudah ditemukan
-- dan dibersihkan, serta menyimpan kunci objek asli bila memakai S3/Cloudinary.
CREATE TABLE IF NOT EXISTS berkas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  driver      TEXT    NOT NULL DEFAULT 'local' CHECK (driver IN ('local','s3','cloudinary')),
  kunci       TEXT    NOT NULL,               -- object key / path relatif
  url         TEXT    NOT NULL,
  nama_asli   TEXT,
  mime        TEXT    NOT NULL,
  ukuran_byte INTEGER NOT NULL,
  tujuan      TEXT    NOT NULL DEFAULT 'umum' -- mapaba | galeri | artikel | dokumen | umum
              CHECK (tujuan IN ('mapaba','galeri','artikel','dokumen','umum')),
  pengunggah  TEXT,                           -- hash IP (publik) atau 'user:<id>' (admin)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_berkas_tujuan ON berkas(tujuan, created_at DESC);

-- Riwayat notifikasi email/WhatsApp agar kegagalan kirim dapat ditelusuri
-- dan tidak ada pengaduan darurat yang lolos tanpa pemberitahuan.
CREATE TABLE IF NOT EXISTS notifikasi_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kanal      TEXT    NOT NULL CHECK (kanal IN ('email','whatsapp')),
  tujuan     TEXT    NOT NULL,
  perihal    TEXT,
  entitas    TEXT,                            -- 'pengaduan' | 'mapaba_pendaftar'
  entitas_id INTEGER,
  status     TEXT    NOT NULL DEFAULT 'terkirim' CHECK (status IN ('terkirim','gagal','dilewati')),
  galat      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 11. View pelaporan
-- -----------------------------------------------------------------------------

-- Padanan tabel "cbt_scores" yang lazim dipakai: satu baris per hasil ujian.
-- Dibuat sebagai VIEW, bukan tabel, agar skor tidak pernah kembar dengan
-- sumber kebenarannya (cbt_sesi) ketika sesi dinilai ulang.
DROP VIEW IF EXISTS cbt_scores;
CREATE VIEW cbt_scores AS
SELECT
  s.id                AS sesi_id,
  s.peserta_id,
  p.nomor_peserta,
  p.nama              AS nama_peserta,
  s.paket_id,
  k.kode              AS kode_paket,
  k.nama              AS nama_paket,
  s.percobaan,
  s.skor,
  s.jumlah_benar,
  s.jumlah_salah,
  s.jumlah_kosong,
  k.jumlah_soal,
  s.mulai_at,
  s.submit_at,
  s.status
FROM cbt_sesi s
JOIN cbt_peserta p ON p.id = s.peserta_id
JOIN cbt_paket   k ON k.id = s.paket_id
WHERE s.status IN ('selesai', 'kedaluwarsa');
