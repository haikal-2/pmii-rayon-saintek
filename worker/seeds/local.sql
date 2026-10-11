INSERT INTO mapaba_gelombang
  (nama, tahun, buka_at, tutup_at, mulai_acara, selesai_acara, lokasi, kuota, biaya, is_aktif)
SELECT
  'MAPABA Lokal Data Uji',
  CAST(strftime('%Y', 'now') AS INTEGER),
  datetime('now', '-1 day'),
  datetime('now', '+30 days'),
  datetime('now', '+40 days'),
  datetime('now', '+42 days'),
  'Sekretariat PR PMII Saintek',
  5,
  0,
  1
WHERE NOT EXISTS (
  SELECT 1
  FROM mapaba_gelombang
  WHERE nama = 'MAPABA Lokal Data Uji'
    AND tahun = CAST(strftime('%Y', 'now') AS INTEGER)
);
