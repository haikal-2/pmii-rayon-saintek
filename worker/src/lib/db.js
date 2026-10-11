const REGISTRATION_FIELDS = {
  status: 'status',
  catatanAdmin: 'catatan_admin',
};

function mapAdminRegistration(row) {
  return {
    id: row.id,
    nomorRegistrasi: row.nomorRegistrasi,
    gelombangId: row.gelombangId,
    namaLengkap: row.namaLengkap,
    nim: row.nim,
    angkatan: row.angkatan,
    universitas: row.universitas,
    fakultas: row.fakultas,
    prodi: row.prodi,
    jenisKelamin: row.jenisKelamin,
    whatsapp: row.whatsapp,
    email: row.email,
    asalDaerah: row.asalDaerah,
    motivasi: row.motivasi,
    riwayatOrganisasi: row.riwayatOrganisasi,
    sumberInformasi: row.sumberInformasi,
    pasFotoId: row.pasFotoId,
    ktmId: row.ktmId,
    status: row.status,
    catatanAdmin: row.catatanAdmin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getActiveWave(db, now = new Date()) {
  const row = await db
    .prepare(
      `SELECT g.id, g.nama, g.tahun, g.buka_at, g.tutup_at, g.mulai_acara,
              g.selesai_acara, g.lokasi, g.kuota, g.biaya,
              COUNT(CASE WHEN p.status <> 'batal' THEN p.id END) AS terpakai
       FROM mapaba_gelombang g
       LEFT JOIN mapaba_pendaftar p ON p.gelombang_id = g.id
       WHERE g.is_aktif = 1
       GROUP BY g.id
       ORDER BY g.tahun DESC, g.id DESC
       LIMIT 1`
    )
    .first();

  if (!row) return null;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const opensAt = new Date(row.buka_at).getTime();
  const closesAt = new Date(row.tutup_at).getTime();
  const terpakai = Number(row.terpakai);

  return {
    id: row.id,
    nama: row.nama,
    tahun: row.tahun,
    bukaAt: row.buka_at,
    tutupAt: row.tutup_at,
    mulaiAcara: row.mulai_acara,
    selesaiAcara: row.selesai_acara,
    lokasi: row.lokasi,
    kuota: row.kuota,
    terpakai,
    sisaKuota: Math.max(0, row.kuota - terpakai),
    biaya: row.biaya,
    sedangDibuka: Number.isFinite(nowMs) && nowMs >= opensAt && nowMs <= closesAt,
  };
}

export async function getRegistrationByTrackingToken(db, tokenHash) {
  const row = await db
    .prepare(
      `SELECT status
       FROM mapaba_pendaftar
       WHERE tracking_token_hash = ?`
    )
    .bind(tokenHash)
    .first();

  return row || null;
}

export async function createRegistration(db, wave, data, trackingTokenHash, now = new Date()) {
  const nowIso = now.toISOString();
  const claimToken = crypto.randomUUID();
  const pasFotoId = data.pasFotoUrl?.split('/').at(-1) || null;
  const ktmId = data.ktmUrl?.split('/').at(-1) || null;
  const uploadIds = [pasFotoId, ktmId].filter(Boolean);
  const statements = [
    db
      .prepare(
        `INSERT INTO counters (nama, tahun, nilai)
         VALUES ('mapaba', ?, 0)
         ON CONFLICT(nama, tahun) DO NOTHING`
      )
      .bind(wave.tahun),
  ];

  if (uploadIds.length) {
    const placeholders = uploadIds.map(() => '?').join(', ');
    statements.push(
      db
        .prepare(
          `UPDATE mapaba_uploads
           SET claimed_at = ?
           WHERE id IN (${placeholders})
             AND claimed_at IS NULL
             AND (
               SELECT COUNT(*) FROM mapaba_uploads
               WHERE id IN (${placeholders}) AND claimed_at IS NULL
             ) = ?
             AND EXISTS (
               SELECT 1 FROM mapaba_gelombang g
               WHERE g.id = ? AND g.is_aktif = 1
                 AND julianday(?) BETWEEN julianday(g.buka_at) AND julianday(g.tutup_at)
                 AND (
                   SELECT COUNT(*) FROM mapaba_pendaftar p
                   WHERE p.gelombang_id = g.id AND p.status <> 'batal'
                 ) < g.kuota
             )
             AND NOT EXISTS (
               SELECT 1 FROM mapaba_pendaftar
               WHERE gelombang_id = ? AND nim = ?
             )`
        )
        .bind(
          claimToken,
          ...uploadIds,
          ...uploadIds,
          uploadIds.length,
          wave.id,
          nowIso,
          wave.id,
          data.nim
        )
    );
  }

  const insertIndex = statements.length;
  statements.push(
    db
      .prepare(
        `INSERT INTO mapaba_pendaftar
           (nomor_registrasi, gelombang_id, nama_lengkap, nim, angkatan, universitas,
            fakultas, prodi, jenis_kelamin, whatsapp, email, asal_daerah, motivasi,
            riwayat_organisasi, sumber_informasi, pas_foto_id, ktm_id, kesediaan,
            persetujuan_data, status, created_at, updated_at, tracking_token_hash)
         SELECT
           'MPB-' || printf('%04d', ?) || '-' || printf('%04d', c.nilai + 1),
           g.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'menunggu', ?, ?, ?
         FROM counters c
         JOIN mapaba_gelombang g ON g.id = ?
         WHERE c.nama = 'mapaba' AND c.tahun = ? AND c.nilai < 9999
           AND g.is_aktif = 1
           AND julianday(?) BETWEEN julianday(g.buka_at) AND julianday(g.tutup_at)
           AND (
             SELECT COUNT(*) FROM mapaba_pendaftar p
             WHERE p.gelombang_id = g.id AND p.status <> 'batal'
           ) < g.kuota
           AND NOT EXISTS (
             SELECT 1 FROM mapaba_pendaftar
             WHERE gelombang_id = g.id AND nim = ?
           )
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM mapaba_uploads
             WHERE id = ? AND claimed_at = ?
           ))
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM mapaba_uploads
             WHERE id = ? AND claimed_at = ?
           ))
         RETURNING id, nomor_registrasi AS nomorRegistrasi, status, created_at AS dibuatPada`
      )
      .bind(
        wave.tahun,
        data.namaLengkap,
        data.nim,
        data.angkatan,
        data.universitas,
        data.fakultas,
        data.prodi,
        data.jenisKelamin,
        data.whatsapp,
        data.email,
        data.asalDaerah || null,
        data.motivasi,
        data.riwayatOrganisasi || null,
        data.sumberInformasi || null,
        pasFotoId,
        ktmId,
        nowIso,
        nowIso,
        trackingTokenHash,
        wave.id,
        wave.tahun,
        nowIso,
        data.nim,
        pasFotoId,
        pasFotoId,
        claimToken,
        ktmId,
        ktmId,
        claimToken
      )
  );
  statements.push(
    db
      .prepare(
        `UPDATE counters SET nilai = nilai + 1
         WHERE nama = 'mapaba' AND tahun = ? AND changes() = 1`
      )
      .bind(wave.tahun)
  );

  const result = await db.batch(statements);
  return result[insertIndex]?.results?.[0] || null;
}

export async function getUpload(db, id) {
  const row = await db
    .prepare(
      `SELECT id, cloudinary_public_id AS cloudinaryPublicId, format, mime,
              ukuran_byte AS sizeBytes, created_at AS createdAt, claimed_at AS claimedAt
       FROM mapaba_uploads
       WHERE id = ?`
    )
    .bind(id)
    .first();

  return row || null;
}

export async function createUpload(db, upload) {
  return db
    .prepare(
      `INSERT INTO mapaba_uploads
         (id, cloudinary_public_id, format, mime, ukuran_byte)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      upload.id,
      upload.cloudinaryPublicId,
      upload.format,
      upload.mime,
      upload.sizeBytes
    )
    .run();
}

export async function listRegistrations(db, filters = {}) {
  const { where, values } = registrationFilters(filters);
  const limit = Number.isFinite(Number(filters.limit))
    ? Math.min(200, Math.max(1, Math.trunc(Number(filters.limit))))
    : 50;
  const offset = Number.isFinite(Number(filters.offset))
    ? Math.max(0, Math.trunc(Number(filters.offset)))
    : 0;

  const result = await db
    .prepare(
      `SELECT id,
              nomor_registrasi AS nomorRegistrasi,
              gelombang_id AS gelombangId,
              nama_lengkap AS namaLengkap,
              nim,
              angkatan,
              universitas,
              fakultas,
              prodi,
              jenis_kelamin AS jenisKelamin,
              whatsapp,
              email,
              asal_daerah AS asalDaerah,
              motivasi,
              riwayat_organisasi AS riwayatOrganisasi,
              sumber_informasi AS sumberInformasi,
              pas_foto_id AS pasFotoId,
              ktm_id AS ktmId,
              status,
              catatan_admin AS catatanAdmin,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM mapaba_pendaftar
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...values, limit, offset)
    .all();

  return (result.results || []).map(mapAdminRegistration);
}

function registrationFilters(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.gelombangId !== undefined) {
    conditions.push('gelombang_id = ?');
    values.push(filters.gelombangId);
  }
  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }

  const search = String(filters.q ?? filters.search ?? '').trim();
  if (search) {
    conditions.push(
      '(nomor_registrasi LIKE ? OR nama_lengkap LIKE ? OR nim LIKE ? OR email LIKE ?)'
    );
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, values };
}

export async function countRegistrations(db, filters = {}) {
  const { where, values } = registrationFilters(filters);
  const result = await db
    .prepare(`SELECT COUNT(*) AS total FROM mapaba_pendaftar ${where}`)
    .bind(...values)
    .first();

  return Number(result?.total || 0);
}

export async function getMapabaAdminSummary(db) {
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'menunggu' THEN 1 ELSE 0 END), 0) AS menunggu,
              COALESCE(SUM(CASE WHEN status = 'terverifikasi' THEN 1 ELSE 0 END), 0)
                AS terverifikasi
       FROM mapaba_pendaftar`
    )
    .first();
  const activeWave = await db
    .prepare(
      `SELECT MAX(0, g.kuota - COUNT(CASE WHEN p.status <> 'batal' THEN p.id END))
                AS sisaKuota
       FROM mapaba_gelombang g
       LEFT JOIN mapaba_pendaftar p ON p.gelombang_id = g.id
       WHERE g.is_aktif = 1
       GROUP BY g.id
       ORDER BY g.tahun DESC, g.id DESC
       LIMIT 1`
    )
    .first();

  return {
    total: Number(totals?.total || 0),
    menunggu: Number(totals?.menunggu || 0),
    terverifikasi: Number(totals?.terverifikasi || 0),
    sisaKuota: activeWave ? Number(activeWave.sisaKuota) : null,
  };
}

export async function getAdminRegistration(db, id) {
  const result = await db
    .prepare(
      `SELECT id,
              nomor_registrasi AS nomorRegistrasi,
              gelombang_id AS gelombangId,
              nama_lengkap AS namaLengkap,
              nim,
              angkatan,
              universitas,
              fakultas,
              prodi,
              jenis_kelamin AS jenisKelamin,
              whatsapp,
              email,
              asal_daerah AS asalDaerah,
              motivasi,
              riwayat_organisasi AS riwayatOrganisasi,
              sumber_informasi AS sumberInformasi,
              pas_foto_id AS pasFotoId,
              ktm_id AS ktmId,
              status,
              catatan_admin AS catatanAdmin,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM mapaba_pendaftar
       WHERE id = ?`
    )
    .bind(id)
    .first();

  return mapAdminRegistration(result);
}

export async function isMapabaUploadAttached(db, id) {
  const result = await db
    .prepare(
      `SELECT 1 AS attached
       FROM mapaba_uploads u
       WHERE u.id = ?
         AND EXISTS (
           SELECT 1 FROM mapaba_pendaftar p
           WHERE p.pas_foto_id = u.id OR p.ktm_id = u.id
         )`
    )
    .bind(id)
    .first();

  return Boolean(result);
}

export async function updateRegistration(db, id, changes, actor) {
  const entries = Object.entries(changes || {}).filter(([field]) =>
    Object.hasOwn(REGISTRATION_FIELDS, field)
  );
  if (!entries.length) return { changes: 0 };

  const assignments = entries.map(([field]) => `${REGISTRATION_FIELDS[field]} = ?`);
  const values = entries.map(([, value]) => value);
  const metadata = JSON.stringify(Object.fromEntries(entries));
  const safeActor = actor === 'system' ? 'system' : 'worker-admin';
  const update = db
    .prepare(
      `UPDATE mapaba_pendaftar
       SET ${assignments.join(', ')}, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(...values, id);
  const audit = db
    .prepare(
      `INSERT INTO audit_log (actor, action, entity, entity_id, metadata)
       SELECT ?, 'mapaba.registration.update', 'mapaba_pendaftar', ?, ?
       WHERE EXISTS (SELECT 1 FROM mapaba_pendaftar WHERE id = ?)`
    )
    .bind(safeActor, String(id), metadata, id);
  const previousStatus = db
    .prepare('SELECT status FROM mapaba_pendaftar WHERE id = ?')
    .bind(id);
  const [previous, result] = await db.batch([previousStatus, update, audit]);

  return {
    changes: Number(result.meta?.changes || 0),
    previousStatus: previous.results?.[0]?.status || null,
  };
}
