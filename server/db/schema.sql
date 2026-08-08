-- =============================================================================
--  Skema basis data — Website PR PMII Saintek UIN SGD
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
  -- panitia_mapaba: verifikasi pendaftar MAPABA
  role          TEXT    NOT NULL DEFAULT 'editor'
                CHECK (role IN ('superadmin','editor','advokat','panitia_mapaba')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  -- Penguncian sementara setelah beberapa kali gagal login
  gagal_login   INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
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
-- 8. Utilitas: penomoran tiket/registrasi & jejak audit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  nama       TEXT    NOT NULL,               -- 'advokasi' | 'mapaba'
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
-- 9. Berkas unggahan & log notifikasi keluar
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

