-- =============================================================================
--  Skema basis data — Website PR PMII Saintek UIN SGD
--  Dialek: MySQL 8.0 / MariaDB 10.6+ (versi produksi)
--
--  Berkas ini adalah padanan penuh dari server/db/schema.sql (SQLite) yang
--  dipakai saat pengembangan. Perbedaan utama:
--    * ENUM menggantikan CHECK (…IN…)
--    * DATETIME / TIMESTAMP menggantikan TEXT ISO-8601
--    * TINYINT(1) menggantikan INTEGER 0/1
--    * BIGINT AUTO_INCREMENT menggantikan INTEGER PRIMARY KEY AUTOINCREMENT
--
--  Cara pakai:
--    mysql -u root -p < server/db/schema.mysql.sql
--
--  Untuk PostgreSQL, lihat catatan konversi di bagian akhir berkas ini.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS pmii_uinsgd
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pmii_uinsgd;

SET NAMES utf8mb4;
SET time_zone = '+07:00';   -- WIB, agar buka/tutup pendaftaran sesuai waktu lokal

-- -----------------------------------------------------------------------------
-- 1. Pengguna internal (pengurus/admin CMS)
--
--    Hanya pengurus yang memiliki akun. Tidak ada pendaftaran mandiri: akun
--    diterbitkan superadmin lewat POST /api/v1/admin/users.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama          VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,          -- bcrypt, selalu 60 karakter
  role          ENUM('superadmin','editor','advokat','panitia_mapaba')
                              NOT NULL DEFAULT 'editor',
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  gagal_login   SMALLINT      NOT NULL DEFAULT 0,   -- penguncian setelah gagal login
  locked_until  DATETIME      NULL,
  last_login_at DATETIME      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 2. Profil organisasi
-- -----------------------------------------------------------------------------
CREATE TABLE periode (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label    VARCHAR(20) NOT NULL,               -- "2025-2026"
  mulai    DATE        NOT NULL,
  selesai  DATE        NOT NULL,
  is_aktif TINYINT(1)  NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_periode_label (label)
) ENGINE=InnoDB;

CREATE TABLE pengurus (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  periode_id BIGINT UNSIGNED NOT NULL,
  nama       VARCHAR(100) NOT NULL,
  jabatan    VARCHAR(100) NOT NULL,
  bidang     VARCHAR(100) NULL,
  foto_url   VARCHAR(500) NULL,
  urutan     INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pengurus_periode (periode_id, urutan),
  CONSTRAINT fk_pengurus_periode FOREIGN KEY (periode_id)
    REFERENCES periode(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 3. CMS Artikel
-- -----------------------------------------------------------------------------
CREATE TABLE kategori (
  id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama VARCHAR(50) NOT NULL,
  slug VARCHAR(60) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kategori_nama (nama),
  UNIQUE KEY uq_kategori_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE artikel (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(120)  NOT NULL,
  judul        VARCHAR(200)  NOT NULL,
  ringkasan    VARCHAR(500)  NOT NULL,          -- teks preview pada kartu
  konten       LONGTEXT      NOT NULL,          -- HTML hasil editor
  cover_url    VARCHAR(500)  NULL,
  kategori_id  BIGINT UNSIGNED NULL,
  penulis_id   BIGINT UNSIGNED NULL,
  penulis_nama VARCHAR(100)  NULL,              -- untuk penulis tamu
  status       ENUM('draft','review','published','archived') NOT NULL DEFAULT 'draft',
  is_unggulan  TINYINT(1)    NOT NULL DEFAULT 0,
  dilihat      INT UNSIGNED  NOT NULL DEFAULT 0,
  published_at DATETIME      NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at   DATETIME      NULL,              -- soft delete
  PRIMARY KEY (id),
  UNIQUE KEY uq_artikel_slug (slug),
  KEY idx_artikel_publik (status, published_at DESC),
  KEY idx_artikel_kategori (kategori_id, published_at DESC),
  FULLTEXT KEY ft_artikel (judul, ringkasan, konten),   -- pencarian bahasa Indonesia
  CONSTRAINT fk_artikel_kategori FOREIGN KEY (kategori_id)
    REFERENCES kategori(id) ON DELETE SET NULL,
  CONSTRAINT fk_artikel_penulis FOREIGN KEY (penulis_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tag (
  id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama VARCHAR(50) NOT NULL,
  slug VARCHAR(60) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tag_nama (nama),
  UNIQUE KEY uq_tag_slug (slug)
) ENGINE=InnoDB;

CREATE TABLE artikel_tag (
  artikel_id BIGINT UNSIGNED NOT NULL,
  tag_id     BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (artikel_id, tag_id),
  CONSTRAINT fk_at_artikel FOREIGN KEY (artikel_id) REFERENCES artikel(id) ON DELETE CASCADE,
  CONSTRAINT fk_at_tag     FOREIGN KEY (tag_id)     REFERENCES tag(id)     ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 4. Galeri kegiatan
-- -----------------------------------------------------------------------------
CREATE TABLE galeri_album (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug       VARCHAR(120) NOT NULL,
  judul      VARCHAR(150) NOT NULL,
  deskripsi  TEXT         NULL,
  kategori   VARCHAR(50)  NULL,                 -- MAPABA, Kajian, Aksi, Pengabdian
  tanggal    DATE         NOT NULL,
  cover_url  VARCHAR(500) NULL,
  is_publik  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_album_slug (slug),
  KEY idx_album_tanggal (tanggal DESC)
) ENGINE=InnoDB;

CREATE TABLE galeri_media (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  album_id  BIGINT UNSIGNED NOT NULL,
  tipe      ENUM('foto','video') NOT NULL DEFAULT 'foto',
  url       VARCHAR(500) NOT NULL,
  thumb_url VARCHAR(500) NULL,                  -- versi kecil untuk grid (lazy load)
  caption   VARCHAR(300) NULL,
  urutan    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_media_album (album_id, urutan),
  CONSTRAINT fk_media_album FOREIGN KEY (album_id)
    REFERENCES galeri_album(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 5. Landasan hukum / dokumen resmi
-- -----------------------------------------------------------------------------
CREATE TABLE dokumen (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  judul       VARCHAR(200) NOT NULL,
  deskripsi   TEXT         NULL,
  kategori    ENUM('konstitusi','ndp','peraturan','kaderisasi','lainnya')
                           NOT NULL DEFAULT 'konstitusi',
  file_url    VARCHAR(500) NOT NULL,
  mime        VARCHAR(100) NULL,
  ukuran_byte BIGINT UNSIGNED NULL,
  tahun       SMALLINT     NULL,
  urutan      INT          NOT NULL DEFAULT 0,
  diunduh     INT UNSIGNED NOT NULL DEFAULT 0,
  is_publik   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dokumen_kategori (kategori, urutan)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 6. Layanan Advokasi — pengaduan (advokasi_reports)
-- -----------------------------------------------------------------------------
CREATE TABLE pengaduan (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor_tiket      VARCHAR(20)  NOT NULL,       -- ADV-2026-0001
  nama             VARCHAR(100) NOT NULL DEFAULT 'Anonim',
  kontak           VARCHAR(30)  NOT NULL,
  email            VARCHAR(150) NULL,
  status_pelapor   ENUM('mahasiswa','alumni','kader','masyarakat') NOT NULL,
  kategori         ENUM('akademik','fasilitas','kekerasan_seksual','ukt','perundungan',
                        'kebebasan_berpendapat','ketenagakerjaan','lainnya') NOT NULL,
  kronologi        MEDIUMTEXT   NOT NULL,
  lampiran_url     VARCHAR(500) NULL,
  is_anonim        TINYINT(1)   NOT NULL DEFAULT 0,
  status           ENUM('baru','verifikasi','pendampingan','selesai','ditolak')
                                NOT NULL DEFAULT 'baru',
  prioritas        ENUM('rendah','normal','tinggi','darurat') NOT NULL DEFAULT 'normal',
  petugas_id       BIGINT UNSIGNED NULL,
  catatan_internal TEXT         NULL,
  ip_hash          CHAR(32)     NULL,           -- hash IP, bukan IP mentah
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at        DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pengaduan_tiket (nomor_tiket),
  KEY idx_pengaduan_status (status, created_at DESC),
  KEY idx_pengaduan_prioritas (prioritas, created_at DESC),
  CONSTRAINT fk_pengaduan_petugas FOREIGN KEY (petugas_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE pengaduan_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pengaduan_id BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NULL,
  status_lama  VARCHAR(20) NULL,
  status_baru  VARCHAR(20) NOT NULL,
  catatan      TEXT        NULL,
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_log_pengaduan (pengaduan_id, id),
  CONSTRAINT fk_log_pengaduan FOREIGN KEY (pengaduan_id)
    REFERENCES pengaduan(id) ON DELETE CASCADE,
  CONSTRAINT fk_log_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 7. MAPABA Raya (mapaba_registrations)
-- -----------------------------------------------------------------------------
CREATE TABLE mapaba_gelombang (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama          VARCHAR(100) NOT NULL,
  tahun         SMALLINT     NOT NULL,
  buka_at       DATETIME     NOT NULL,
  tutup_at      DATETIME     NOT NULL,
  mulai_acara   DATETIME     NULL,
  selesai_acara DATETIME     NULL,
  lokasi        VARCHAR(200) NULL,
  kuota         INT          NOT NULL DEFAULT 150,
  biaya         INT          NOT NULL DEFAULT 75000,
  is_aktif      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_gelombang_aktif (is_aktif, tahun DESC)
) ENGINE=InnoDB;

CREATE TABLE mapaba_pendaftar (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nomor_registrasi   VARCHAR(20)  NOT NULL,     -- MPB-2026-0001
  gelombang_id       BIGINT UNSIGNED NOT NULL,
  nama_lengkap       VARCHAR(100) NOT NULL,
  nim                VARCHAR(20)  NOT NULL,
  angkatan           SMALLINT     NOT NULL,
  universitas        VARCHAR(150) NOT NULL DEFAULT 'UIN Sunan Gunung Djati Bandung',
  fakultas           VARCHAR(100) NOT NULL,
  prodi              VARCHAR(100) NOT NULL,
  jenis_kelamin      ENUM('L','P') NOT NULL,
  whatsapp           VARCHAR(30)  NOT NULL,
  email              VARCHAR(150) NOT NULL,
  asal_daerah        VARCHAR(100) NULL,
  motivasi           TEXT         NOT NULL,     -- "alasan ikut"
  riwayat_organisasi VARCHAR(200) NULL,
  sumber_informasi   VARCHAR(50)  NULL,
  pas_foto_url       VARCHAR(500) NULL,
  ktm_url            VARCHAR(500) NULL,
  bukti_bayar_url    VARCHAR(500) NULL,
  status             ENUM('menunggu','terverifikasi','hadir','ditolak','batal')
                                  NOT NULL DEFAULT 'menunggu',
  catatan_panitia    TEXT         NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mapaba_registrasi (nomor_registrasi),
  -- Satu NIM hanya boleh mendaftar sekali per gelombang
  UNIQUE KEY uq_mapaba_gelombang_nim (gelombang_id, nim),
  KEY idx_mapaba_status (gelombang_id, status),
  CONSTRAINT fk_mapaba_gelombang FOREIGN KEY (gelombang_id)
    REFERENCES mapaba_gelombang(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 8. Utilitas
-- -----------------------------------------------------------------------------
CREATE TABLE counters (
  nama  VARCHAR(30) NOT NULL,                   -- 'advokasi' | 'mapaba'
  tahun SMALLINT    NOT NULL,
  nilai INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (nama, tahun)
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL,
  aksi       VARCHAR(80)  NOT NULL,             -- 'pengaduan.update'
  entitas    VARCHAR(50)  NULL,
  entitas_id BIGINT UNSIGNED NULL,
  metadata   JSON         NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entitas (entitas, entitas_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE settings (
  kunci VARCHAR(80) NOT NULL,
  nilai TEXT        NOT NULL,
  PRIMARY KEY (kunci)
) ENGINE=InnoDB;

CREATE TABLE berkas (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  driver      ENUM('local','s3','cloudinary') NOT NULL DEFAULT 'local',
  kunci       VARCHAR(500) NOT NULL,
  url         VARCHAR(700) NOT NULL,
  nama_asli   VARCHAR(255) NULL,
  mime        VARCHAR(100) NOT NULL,
  ukuran_byte BIGINT UNSIGNED NOT NULL,
  tujuan      ENUM('mapaba','galeri','artikel','dokumen','umum') NOT NULL DEFAULT 'umum',
  pengunggah  VARCHAR(80)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_berkas_tujuan (tujuan, created_at DESC)
) ENGINE=InnoDB;

CREATE TABLE notifikasi_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kanal      ENUM('email','whatsapp') NOT NULL,
  tujuan     VARCHAR(200) NOT NULL,
  perihal    VARCHAR(200) NULL,
  entitas    VARCHAR(50)  NULL,
  entitas_id BIGINT UNSIGNED NULL,
  status     ENUM('terkirim','gagal','dilewati') NOT NULL DEFAULT 'terkirim',
  galat      TEXT         NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_entitas (entitas, entitas_id)
) ENGINE=InnoDB;

-- =============================================================================
--  CATATAN KONVERSI
-- =============================================================================
--
--  A. PostgreSQL
--     * BIGINT UNSIGNED AUTO_INCREMENT  →  BIGSERIAL / GENERATED ALWAYS AS IDENTITY
--     * TINYINT(1)                      →  BOOLEAN
--     * DATETIME                        →  TIMESTAMPTZ
--     * ENUM(...) inline                →  CREATE TYPE nama_enum AS ENUM (...)
--     * JSON                            →  JSONB
--     * ON UPDATE CURRENT_TIMESTAMP     →  trigger BEFORE UPDATE
--     * FULLTEXT KEY                    →  GIN index atas to_tsvector('indonesian', …)
--     * RANK() OVER (…)                 →  identik, sudah didukung
--
--  B. Pengguna basis data untuk aplikasi sebaiknya TIDAK memakai root:
--     CREATE USER 'pmii_app'@'localhost' IDENTIFIED BY '<sandi-acak-panjang>';
--     GRANT SELECT, INSERT, UPDATE, DELETE ON pmii_uinsgd.* TO 'pmii_app'@'localhost';
--     FLUSH PRIVILEGES;
