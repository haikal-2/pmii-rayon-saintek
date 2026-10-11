ALTER TABLE mapaba_pendaftar ADD COLUMN tracking_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mapaba_tracking_token_hash
  ON mapaba_pendaftar(tracking_token_hash)
  WHERE tracking_token_hash IS NOT NULL;
