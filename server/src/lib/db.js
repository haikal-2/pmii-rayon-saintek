/**
 * Koneksi basis data (SQLite via better-sqlite3).
 *
 * better-sqlite3 bersifat sinkron sehingga cocok untuk trafik website organisasi
 * dan menghilangkan kompleksitas async pada layer query. Bila trafik
 * meningkat, ganti implementasi file ini dengan pool MySQL/PostgreSQL —
 * pemanggil hanya memakai `db.prepare(...)`, sehingga perubahan terlokalisasi.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH =
  process.env.DATABASE_PATH || path.join(__dirname, '../../db/pmii.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL: pembacaan tidak terblokir saat ada penulisan.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Kolom yang ditambahkan setelah rilis pertama.
 *
 * `CREATE TABLE IF NOT EXISTS` tidak menyentuh tabel yang sudah ada, sehingga
 * basis data lama tidak akan mendapat kolom baru dari schema.sql. Daftar di bawah
 * menambalnya secara idempoten. Untuk perubahan yang lebih berat (mis. mengubah
 * CHECK constraint), buat tabel baru lalu salin datanya.
 */
const KOLOM_TAMBAHAN = [
  ['users', 'gagal_login', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'locked_until', 'TEXT'],
  ['mapaba_pendaftar', 'universitas', "TEXT NOT NULL DEFAULT 'UIN Sunan Gunung Djati Bandung'"],
  ['mapaba_pendaftar', 'pas_foto_url', 'TEXT'],
  ['mapaba_pendaftar', 'ktm_url', 'TEXT'],
];

function ensureColumn(table, column, ddl) {
  const adaTabel = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!adaTabel) return false;

  const kolom = db.prepare(`PRAGMA table_info(${table})`).all();
  if (kolom.some((item) => item.name === column)) return false;

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

/** Jalankan skema (idempoten, semua CREATE memakai IF NOT EXISTS). */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
  db.exec(schema);

  const ditambahkan = KOLOM_TAMBAHAN.filter(([table, column, ddl]) =>
    ensureColumn(table, column, ddl)
  );
  if (ditambahkan.length) {
    console.log(
      `Kolom baru ditambahkan: ${ditambahkan.map(([t, c]) => `${t}.${c}`).join(', ')}`
    );
  }

  return DB_PATH;
}

/**
 * Terbitkan nomor urut per tahun, mis. ADV-2026-0001.
 * Dijalankan dalam transaksi agar tidak menghasilkan nomor ganda.
 */
const nextNumber = db.transaction((nama, prefix, tahun = new Date().getFullYear()) => {
  db.prepare(
    `INSERT INTO counters (nama, tahun, nilai) VALUES (?, ?, 0)
     ON CONFLICT(nama, tahun) DO NOTHING`
  ).run(nama, tahun);

  const { nilai } = db
    .prepare(
      `UPDATE counters SET nilai = nilai + 1
       WHERE nama = ? AND tahun = ?
       RETURNING nilai`
    )
    .get(nama, tahun);

  return `${prefix}-${tahun}-${String(nilai).padStart(4, '0')}`;
});

module.exports = { db, migrate, nextNumber, DB_PATH };
