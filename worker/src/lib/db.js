const REGISTRATION_FIELDS = {
  status: 'status',
  catatanAdmin: 'catatan_admin',
};

function mapPublicRegistration(row) {
  if (!row) return null;

  return {
    nomorRegistrasi: row.nomorRegistrasi,
    namaLengkap: row.namaLengkap,
    fakultas: row.fakultas,
    prodi: row.prodi,
    status: row.status,
    createdAt: row.createdAt,
  };
}

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

export async function getRegistrationByNumber(db, nomor) {
  const row = await db
    .prepare(
      `SELECT nomor_registrasi AS nomorRegistrasi,
              nama_lengkap AS namaLengkap,
              fakultas,
              prodi,
              status,
              created_at AS createdAt
       FROM mapaba_pendaftar
       WHERE nomor_registrasi = ?`
    )
    .bind(nomor)
    .first();

  return mapPublicRegistration(row);
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

export async function listRegistrations(db, filters = {}) {
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
  const [result] = await db.batch([update, audit]);

  return { changes: Number(result.meta?.changes || 0) };
}
