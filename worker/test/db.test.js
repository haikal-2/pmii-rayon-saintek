import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  getActiveWave,
  getRegistrationByNumber,
  getUpload,
  listRegistrations,
  updateRegistration,
} from '../src/lib/db.js';

let sequence = 0;

async function insertFixtureRegistration(overrides = {}) {
  const suffix = `${Date.now()}${++sequence}`;
  const waveResult = await env.DB.prepare(
    `INSERT INTO mapaba_gelombang
       (nama, tahun, buka_at, tutup_at, lokasi, kuota, biaya, is_aktif)
     VALUES (?, 2099, '2025-01-01T00:00:00Z', '2099-12-31T23:59:59Z', ?, 5, 0, 1)`
  )
    .bind(`Gelombang ${suffix}`, 'Sekretariat')
    .run();
  const waveId = waveResult.meta.last_row_id;
  const registration = {
    number: `MPB-2099-${String(sequence).padStart(4, '0')}`,
    nim: String(Date.now() + sequence),
    name: `Peserta ${suffix}`,
    status: 'menunggu',
    ...overrides,
  };

  const registrationResult = await env.DB.prepare(
    `INSERT INTO mapaba_pendaftar
       (nomor_registrasi, gelombang_id, nama_lengkap, nim, angkatan, universitas,
        fakultas, prodi, jenis_kelamin, whatsapp, email, asal_daerah, motivasi,
        riwayat_organisasi, sumber_informasi, pas_foto_id, ktm_id, kesediaan,
        persetujuan_data, status, catatan_admin)
     VALUES (?, ?, ?, ?, 2099, 'UIN Sunan Gunung Djati Bandung', 'Sains dan Teknologi',
             'Informatika', 'P', '08123456789', 'private@example.test', NULL,
             'Motivasi fixture yang cukup panjang untuk melewati validasi.', NULL, NULL,
             NULL, NULL, 1, 1, ?, NULL)`
  )
    .bind(
      registration.number,
      waveId,
      registration.name,
      registration.nim,
      registration.status
    )
    .run();

  return { id: registrationResult.meta.last_row_id, waveId, ...registration };
}

describe('MAPABA D1 repository', () => {
  it('reads an active wave with current usage and available quota', async () => {
    const fixture = await insertFixtureRegistration();
    const wave = await getActiveWave(env.DB, new Date('2099-06-01T00:00:00Z'));

    expect(wave).toMatchObject({
      id: fixture.waveId,
      nama: expect.stringContaining('Gelombang'),
      kuota: 5,
      terpakai: 1,
      sisaKuota: 4,
      sedangDibuka: true,
    });
  });

  it('stores registrations but exposes only the public tracking projection', async () => {
    const fixture = await insertFixtureRegistration();
    const row = await getRegistrationByNumber(env.DB, fixture.number);

    expect(row).toMatchObject({
      nomorRegistrasi: fixture.number,
      namaLengkap: fixture.name,
      fakultas: 'Sains dan Teknologi',
      prodi: 'Informatika',
      status: 'menunggu',
    });
    expect(row).toHaveProperty('createdAt');
    expect(row).not.toHaveProperty('nim');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('whatsapp');
    expect(row).not.toHaveProperty('motivasi');
  });

  it('rejects a duplicate NIM within the same wave', async () => {
    const fixture = await insertFixtureRegistration();

    await expect(
      env.DB.prepare(
        `INSERT INTO mapaba_pendaftar
           (nomor_registrasi, gelombang_id, nama_lengkap, nim, angkatan, fakultas,
            prodi, jenis_kelamin, whatsapp, email, motivasi, kesediaan, persetujuan_data)
         VALUES (?, ?, 'Duplikat', ?, 2099, 'Fakultas', 'Prodi', 'L', '08123456789',
                 'duplicate@example.test', 'Motivasi yang cukup panjang untuk fixture.', 1, 1)`
      )
        .bind(`MPB-2099-${String(++sequence).padStart(4, '0')}`, fixture.waveId, fixture.nim)
        .run()
    ).rejects.toThrow();
  });

  it('loads stored upload metadata by opaque ID', async () => {
    const id = `upload-${Date.now()}-${++sequence}`;
    await env.DB.prepare(
      `INSERT INTO mapaba_uploads
         (id, cloudinary_public_id, format, mime, ukuran_byte)
       VALUES (?, ?, 'jpg', 'image/jpeg', 1234)`
    )
      .bind(id, `private/${id}`)
      .run();

    await expect(getUpload(env.DB, id)).resolves.toMatchObject({
      id,
      cloudinaryPublicId: `private/${id}`,
      format: 'jpg',
      mime: 'image/jpeg',
      sizeBytes: 1234,
      claimedAt: null,
    });
  });

  it('filters and bounds the admin registration list', async () => {
    const fixture = await insertFixtureRegistration();
    const rows = await listRegistrations(env.DB, {
      gelombangId: fixture.waveId,
      status: 'menunggu',
      limit: 500,
      offset: 0,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nomorRegistrasi: fixture.number,
      nim: fixture.nim,
      status: 'menunggu',
    });
  });

  it('records status changes without persisting the admin token as actor', async () => {
    const fixture = await insertFixtureRegistration();
    const secret = 'super-secret-admin-token';

    await updateRegistration(
      env.DB,
      fixture.id,
      { status: 'terverifikasi', catatanAdmin: 'Dokumen diperiksa.' },
      secret
    );

    const row = await listRegistrations(env.DB, { gelombangId: fixture.waveId });
    const audit = await env.DB.prepare(
      `SELECT actor, action, entity, entity_id, metadata
       FROM audit_log WHERE entity_id = ?`
    )
      .bind(String(fixture.id))
      .first();

    expect(row[0].status).toBe('terverifikasi');
    expect(audit).toMatchObject({
      actor: 'worker-admin',
      action: 'mapaba.registration.update',
      entity: 'mapaba_pendaftar',
      entity_id: String(fixture.id),
    });
    expect(JSON.stringify(audit)).not.toContain(secret);
  });
});
