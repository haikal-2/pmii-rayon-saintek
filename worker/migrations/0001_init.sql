CREATE TABLE IF NOT EXISTS mapaba_uploads (
  id TEXT PRIMARY KEY,
  cloudinary_public_id TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('jpg', 'png', 'webp')),
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  ukuran_byte INTEGER NOT NULL CHECK (ukuran_byte > 0 AND ukuran_byte <= 3145728),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT
);

CREATE TABLE IF NOT EXISTS mapaba_gelombang (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  tahun INTEGER NOT NULL,
  buka_at TEXT NOT NULL,
  tutup_at TEXT NOT NULL,
  mulai_acara TEXT,
  selesai_acara TEXT,
  lokasi TEXT,
  kuota INTEGER NOT NULL DEFAULT 150 CHECK (kuota >= 0),
  biaya INTEGER NOT NULL DEFAULT 75000 CHECK (biaya >= 0),
  is_aktif INTEGER NOT NULL DEFAULT 1 CHECK (is_aktif IN (0, 1))
);

CREATE TABLE IF NOT EXISTS mapaba_pendaftar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_registrasi TEXT NOT NULL UNIQUE,
  gelombang_id INTEGER NOT NULL REFERENCES mapaba_gelombang(id) ON DELETE CASCADE,
  nama_lengkap TEXT NOT NULL,
  nim TEXT NOT NULL,
  angkatan INTEGER NOT NULL,
  universitas TEXT NOT NULL DEFAULT 'UIN Sunan Gunung Djati Bandung',
  fakultas TEXT NOT NULL,
  prodi TEXT NOT NULL,
  jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL,
  asal_daerah TEXT,
  motivasi TEXT NOT NULL,
  riwayat_organisasi TEXT,
  sumber_informasi TEXT,
  pas_foto_id TEXT REFERENCES mapaba_uploads(id),
  ktm_id TEXT REFERENCES mapaba_uploads(id),
  kesediaan INTEGER NOT NULL CHECK (kesediaan = 1),
  persetujuan_data INTEGER NOT NULL CHECK (persetujuan_data = 1),
  status TEXT NOT NULL DEFAULT 'menunggu'
    CHECK (status IN ('menunggu', 'terverifikasi', 'hadir', 'ditolak', 'batal')),
  catatan_admin TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (gelombang_id, nim)
);

CREATE TABLE IF NOT EXISTS counters (
  nama TEXT NOT NULL,
  tahun INTEGER NOT NULL,
  nilai INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (nama, tahun)
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  scope TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (scope, ip_hash, window_start)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'google_sheets')),
  destination TEXT NOT NULL,
  subject TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('terkirim', 'gagal', 'dilewati')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mapaba_gelombang_aktif
  ON mapaba_gelombang(is_aktif, tahun DESC);
CREATE INDEX IF NOT EXISTS idx_mapaba_pendaftar_gelombang_status
  ON mapaba_pendaftar(gelombang_id, status);
CREATE INDEX IF NOT EXISTS idx_mapaba_pendaftar_created
  ON mapaba_pendaftar(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mapaba_uploads_claimed
  ON mapaba_uploads(claimed_at);
