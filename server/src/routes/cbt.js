/**
 * CBT BIMTES — Computer Based Test.
 *
 * Autentikasi peserta:
 *   POST /api/v1/cbt/auth/login              login dengan nomor peserta/email
 *   POST /api/v1/cbt/auth/refresh            tukar refresh token
 *   GET  /api/v1/cbt/me                      profil peserta yang sedang login
 *
 * Alur ujian (semua butuh Bearer access token peserta):
 *   GET  /api/v1/cbt/ujian                   daftar paket tryout + status peserta
 *   POST /api/v1/cbt/ujian/:paketId/mulai    mulai / lanjutkan sesi
 *   GET  /api/v1/cbt/sesi/:sesiId            soal, jawaban tersimpan, sisa waktu
 *   PUT  /api/v1/cbt/sesi/:sesiId/jawaban    autosave satu jawaban
 *   POST /api/v1/cbt/sesi/:sesiId/submit     kumpulkan & nilai
 *   GET  /api/v1/cbt/hasil                   riwayat & skor
 *
 * Prinsip keamanan yang dipegang di file ini:
 *   1. Kunci jawaban (cbt_opsi.is_benar) tidak pernah dikirim selama sesi berjalan.
 *   2. Waktu ujian dihitung dari `deadline_at` di basis data, bukan dari klien.
 *   3. Pengacakan soal disimpan di sesi agar konsisten ketika halaman dimuat ulang.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { db } = require('../lib/db');
const { signAccess, signRefresh, verify, hashOpaque } = require('../lib/tokens');
const { requirePeserta } = require('../middleware/auth');
const {
  ok,
  created,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  asyncHandler,
  parseOrThrow,
} = require('../lib/http');

const router = express.Router();

const MAX_GAGAL_LOGIN = 5;
const LOCK_MENIT = 15;

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Terlalu banyak percobaan login. Coba lagi 10 menit kemudian.' },
});

/* ------------------------------------------------------------ Autentikasi */

router.post(
  '/auth/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const data = parseOrThrow(
      z.object({
        identitas: z.string().trim().min(3, 'Nomor peserta atau email wajib diisi.').max(120),
        password: z.string().min(6, 'Kata sandi minimal 6 karakter.').max(200),
        ingatSaya: z.coerce.boolean().optional().default(false),
      }),
      req.body
    );

    const peserta = db
      .prepare(
        `SELECT * FROM cbt_peserta
         WHERE nomor_peserta = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`
      )
      .get(data.identitas, data.identitas);

    // Pesan galat disengaja tidak membedakan "akun tidak ada" dan "sandi salah"
    // agar nomor peserta tidak bisa ditebak dari respons.
    const gagal = () => unauthorized('Nomor peserta atau kata sandi salah.');

    if (!peserta) throw gagal();
    if (!peserta.is_active) throw forbidden('Akun peserta dinonaktifkan. Hubungi panitia.');

    if (peserta.locked_until && new Date(`${peserta.locked_until}Z`) > new Date()) {
      throw forbidden(
        `Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi setelah ${peserta.locked_until} UTC.`
      );
    }

    const cocok = await bcrypt.compare(data.password, peserta.password_hash);
    if (!cocok) {
      const gagalBaru = peserta.gagal_login + 1;
      db.prepare(
        `UPDATE cbt_peserta SET
           gagal_login  = @gagalBaru,
           locked_until = CASE WHEN @gagalBaru >= @maks
                               THEN datetime('now', @durasi) ELSE locked_until END
         WHERE id = @id`
      ).run({
        id: peserta.id,
        gagalBaru,
        maks: MAX_GAGAL_LOGIN,
        durasi: `+${LOCK_MENIT} minutes`,
      });
      throw gagal();
    }

    db.prepare(
      `UPDATE cbt_peserta
       SET gagal_login = 0, locked_until = NULL, last_login_at = datetime('now')
       WHERE id = ?`
    ).run(peserta.id);

    const payload = { sub: peserta.id, nomor: peserta.nomor_peserta };

    return ok(res, {
      accessToken: signAccess(payload, 'cbt'),
      ...(data.ingatSaya ? { refreshToken: signRefresh(payload, 'cbt') } : {}),
      harusUbahSandi: Boolean(peserta.must_change_password),
      peserta: {
        id: peserta.id,
        nomorPeserta: peserta.nomor_peserta,
        nama: peserta.nama,
        email: peserta.email,
      },
    });
  })
);

router.post(
  '/auth/refresh',
  asyncHandler((req, res) => {
    const { refreshToken } = parseOrThrow(
      z.object({ refreshToken: z.string().min(10, 'Refresh token wajib dikirim.') }),
      req.body
    );

    let payload;
    try {
      payload = verify(refreshToken, 'cbt');
    } catch {
      throw unauthorized('Refresh token tidak valid atau sudah kedaluwarsa.');
    }
    if (payload.typ !== 'refresh') throw unauthorized('Token bukan refresh token.');

    return ok(res, {
      accessToken: signAccess({ sub: payload.sub, nomor: payload.nomor }, 'cbt'),
    });
  })
);

router.get(
  '/me',
  requirePeserta,
  asyncHandler((req, res) =>
    ok(res, {
      id: req.peserta.id,
      nomorPeserta: req.peserta.nomor_peserta,
      nama: req.peserta.nama,
      email: req.peserta.email,
    })
  )
);

/* ------------------------------------------------------------ Daftar ujian */

router.get(
  '/ujian',
  requirePeserta,
  asyncHandler((req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.kode, p.nama, p.deskripsi, p.durasi_menit AS durasiMenit,
                p.jumlah_soal AS jumlahSoal, p.max_percobaan AS maxPercobaan,
                p.buka_at AS bukaAt, p.tutup_at AS tutupAt,
                (SELECT COUNT(*) FROM cbt_sesi s
                  WHERE s.paket_id = p.id AND s.peserta_id = @pesertaId) AS percobaanTerpakai,
                (SELECT s.id FROM cbt_sesi s
                  WHERE s.paket_id = p.id AND s.peserta_id = @pesertaId AND s.status = 'berjalan'
                  ORDER BY s.id DESC LIMIT 1) AS sesiBerjalanId,
                (SELECT MAX(s.skor) FROM cbt_sesi s
                  WHERE s.paket_id = p.id AND s.peserta_id = @pesertaId AND s.status = 'selesai') AS skorTerbaik
         FROM cbt_paket p
         WHERE p.is_aktif = 1
         ORDER BY COALESCE(p.buka_at, p.created_at) ASC`
      )
      .all({ pesertaId: req.peserta.id });

    const now = new Date();
    const data = rows.map((row) => {
      const belumDibuka = row.bukaAt && new Date(row.bukaAt) > now;
      const sudahTutup = row.tutupAt && new Date(row.tutupAt) < now;
      let status = 'tersedia';
      if (belumDibuka) status = 'terjadwal';
      else if (sudahTutup) status = 'ditutup';
      else if (row.sesiBerjalanId) status = 'berjalan';
      else if (row.percobaanTerpakai >= row.maxPercobaan) status = 'selesai';

      return { ...row, status, sisaPercobaan: Math.max(0, row.maxPercobaan - row.percobaanTerpakai) };
    });

    return ok(res, data);
  })
);

/* -------------------------------------------------------------- Sesi ujian */

/** Acak larik dengan Fisher–Yates. */
function shuffle(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Ambil sesi milik peserta atau lempar 404/403. */
function sesiMilikPeserta(sesiId, pesertaId) {
  const sesi = db.prepare('SELECT * FROM cbt_sesi WHERE id = ?').get(sesiId);
  if (!sesi) throw notFound('Sesi ujian tidak ditemukan.');
  if (sesi.peserta_id !== pesertaId) throw forbidden('Sesi ini bukan milikmu.');
  return sesi;
}

/**
 * Tandai sesi kedaluwarsa bila deadline terlampaui, lalu nilai otomatis.
 * Dipanggil setiap kali sesi diakses sehingga peserta tidak bisa "menahan" waktu
 * dengan menutup browser.
 */
function terapkanDeadline(sesi) {
  if (sesi.status !== 'berjalan') return sesi;
  if (new Date(`${sesi.deadline_at}Z`) > new Date()) return sesi;

  nilaiSesi(sesi.id, 'kedaluwarsa');
  return db.prepare('SELECT * FROM cbt_sesi WHERE id = ?').get(sesi.id);
}

router.post(
  '/ujian/:paketId/mulai',
  requirePeserta,
  asyncHandler((req, res) => {
    const paket = db
      .prepare('SELECT * FROM cbt_paket WHERE id = ? AND is_aktif = 1')
      .get(req.params.paketId);
    if (!paket) throw notFound('Paket ujian tidak ditemukan atau tidak aktif.');

    const now = new Date();
    if (paket.buka_at && new Date(paket.buka_at) > now) throw badRequest('Ujian belum dibuka.');
    if (paket.tutup_at && new Date(paket.tutup_at) < now) throw badRequest('Ujian sudah ditutup.');

    // Lanjutkan sesi yang masih berjalan (mis. peserta me-refresh halaman).
    const berjalan = db
      .prepare(
        `SELECT * FROM cbt_sesi
         WHERE peserta_id = ? AND paket_id = ? AND status = 'berjalan'
         ORDER BY id DESC LIMIT 1`
      )
      .get(req.peserta.id, paket.id);

    if (berjalan) {
      const sesi = terapkanDeadline(berjalan);
      if (sesi.status === 'berjalan') {
        return ok(res, { sesiId: sesi.id, deadlineAt: sesi.deadline_at, dilanjutkan: true });
      }
    }

    const terpakai = db
      .prepare('SELECT COUNT(*) AS n FROM cbt_sesi WHERE peserta_id = ? AND paket_id = ?')
      .get(req.peserta.id, paket.id).n;
    if (terpakai >= paket.max_percobaan) throw forbidden('Kesempatan mengerjakan sudah habis.');

    const soalIds = db
      .prepare('SELECT id FROM cbt_soal WHERE paket_id = ? ORDER BY urutan, id')
      .all(paket.id)
      .map((row) => row.id);
    if (!soalIds.length) throw badRequest('Paket ini belum memiliki soal.');

    const urutan = paket.acak_soal ? shuffle(soalIds) : soalIds;

    const info = db
      .prepare(
        `INSERT INTO cbt_sesi
           (peserta_id, paket_id, percobaan, urutan_soal, deadline_at, device_hash)
         VALUES (?, ?, ?, ?, datetime('now', ?), ?)`
      )
      .run(
        req.peserta.id,
        paket.id,
        terpakai + 1,
        JSON.stringify(urutan),
        `+${paket.durasi_menit} minutes`,
        hashOpaque(`${req.ip}|${req.headers['user-agent'] || ''}`)
      );

    const sesi = db.prepare('SELECT * FROM cbt_sesi WHERE id = ?').get(info.lastInsertRowid);

    return created(res, {
      sesiId: sesi.id,
      percobaan: sesi.percobaan,
      mulaiAt: sesi.mulai_at,
      deadlineAt: sesi.deadline_at,
      durasiMenit: paket.durasi_menit,
      jumlahSoal: urutan.length,
      dilanjutkan: false,
    });
  })
);

router.get(
  '/sesi/:sesiId',
  requirePeserta,
  asyncHandler((req, res) => {
    const sesi = terapkanDeadline(sesiMilikPeserta(req.params.sesiId, req.peserta.id));
    const paket = db.prepare('SELECT * FROM cbt_paket WHERE id = ?').get(sesi.paket_id);

    const urutan = JSON.parse(sesi.urutan_soal || '[]');
    const soalRows = db
      .prepare(
        `SELECT id, subtes, tipe, pertanyaan, gambar_url AS gambarUrl
         FROM cbt_soal WHERE paket_id = ?`
      )
      .all(sesi.paket_id);
    const soalById = new Map(soalRows.map((row) => [row.id, row]));

    const jawaban = db
      .prepare('SELECT soal_id AS soalId, opsi_id AS opsiId, teks_isian AS teksIsian, ragu FROM cbt_jawaban WHERE sesi_id = ?')
      .all(sesi.id);
    const jawabanById = new Map(jawaban.map((row) => [row.soalId, row]));

    const selesai = sesi.status !== 'berjalan';

    const soal = urutan
      .filter((id) => soalById.has(id))
      .map((id, index) => {
        const item = soalById.get(id);
        let opsi = db
          .prepare(
            `SELECT id, label, teks, gambar_url AS gambarUrl${selesai ? ', is_benar AS isBenar' : ''}
             FROM cbt_opsi WHERE soal_id = ? ORDER BY label`
          )
          .all(id);
        if (paket.acak_opsi && !selesai) opsi = shuffle(opsi);

        const tersimpan = jawabanById.get(id);
        return {
          nomor: index + 1,
          id: item.id,
          subtes: item.subtes,
          tipe: item.tipe,
          pertanyaan: item.pertanyaan,
          gambarUrl: item.gambarUrl,
          opsi,
          jawaban: tersimpan ? { opsiId: tersimpan.opsiId, teksIsian: tersimpan.teksIsian, ragu: Boolean(tersimpan.ragu) } : null,
          // Pembahasan hanya dibuka setelah sesi selesai dan paket mengizinkan.
          ...(selesai && paket.tampilkan_pembahasan
            ? { pembahasan: db.prepare('SELECT pembahasan FROM cbt_soal WHERE id = ?').get(id).pembahasan }
            : {}),
        };
      });

    const sisaDetik = Math.max(
      0,
      Math.floor((new Date(`${sesi.deadline_at}Z`).getTime() - Date.now()) / 1000)
    );

    return ok(res, {
      sesi: {
        id: sesi.id,
        status: sesi.status,
        mulaiAt: sesi.mulai_at,
        deadlineAt: sesi.deadline_at,
        sisaDetik,
        skor: sesi.skor,
      },
      paket: { id: paket.id, nama: paket.nama, durasiMenit: paket.durasi_menit },
      soal,
    });
  })
);

router.put(
  '/sesi/:sesiId/jawaban',
  requirePeserta,
  asyncHandler((req, res) => {
    const data = parseOrThrow(
      z.object({
        soalId: z.coerce.number().int().positive(),
        opsiId: z.coerce.number().int().positive().nullable().optional(),
        teksIsian: z.string().trim().max(500).optional(),
        ragu: z.coerce.boolean().optional().default(false),
      }),
      req.body
    );

    const sesi = terapkanDeadline(sesiMilikPeserta(req.params.sesiId, req.peserta.id));
    if (sesi.status !== 'berjalan') throw forbidden('Sesi sudah berakhir, jawaban tidak dapat diubah.');

    const soal = db
      .prepare('SELECT id FROM cbt_soal WHERE id = ? AND paket_id = ?')
      .get(data.soalId, sesi.paket_id);
    if (!soal) throw badRequest('Soal tidak terdaftar pada paket ujian ini.');

    if (data.opsiId) {
      const opsi = db
        .prepare('SELECT id FROM cbt_opsi WHERE id = ? AND soal_id = ?')
        .get(data.opsiId, data.soalId);
      if (!opsi) throw badRequest('Opsi jawaban tidak valid untuk soal ini.');
    }

    // UPSERT: satu baris per (sesi, soal) sehingga autosave idempoten.
    db.prepare(
      `INSERT INTO cbt_jawaban (sesi_id, soal_id, opsi_id, teks_isian, ragu, answered_at)
       VALUES (@sesiId, @soalId, @opsiId, @teksIsian, @ragu, datetime('now'))
       ON CONFLICT(sesi_id, soal_id) DO UPDATE SET
         opsi_id = excluded.opsi_id,
         teks_isian = excluded.teks_isian,
         ragu = excluded.ragu,
         answered_at = excluded.answered_at`
    ).run({
      sesiId: sesi.id,
      soalId: data.soalId,
      opsiId: data.opsiId ?? null,
      teksIsian: data.teksIsian ?? null,
      ragu: data.ragu ? 1 : 0,
    });

    const sisaDetik = Math.max(
      0,
      Math.floor((new Date(`${sesi.deadline_at}Z`).getTime() - Date.now()) / 1000)
    );
    return ok(res, { tersimpan: true, soalId: data.soalId, sisaDetik });
  })
);

/**
 * Penilaian sesi. Skala skor 0–1000 (menyerupai UTBK) dihitung dari bobot soal.
 * Dijalankan dalam transaksi agar status dan nilai selalu konsisten.
 */
const nilaiSesi = db.transaction((sesiId, statusAkhir = 'selesai') => {
  const sesi = db.prepare('SELECT * FROM cbt_sesi WHERE id = ?').get(sesiId);
  const soal = db
    .prepare('SELECT id, bobot FROM cbt_soal WHERE paket_id = ?')
    .all(sesi.paket_id);

  const kunci = new Map(
    db
      .prepare(
        `SELECT o.soal_id AS soalId, o.id AS opsiId
         FROM cbt_opsi o
         JOIN cbt_soal s ON s.id = o.soal_id
         WHERE s.paket_id = ? AND o.is_benar = 1`
      )
      .all(sesi.paket_id)
      .map((row) => [row.soalId, row.opsiId])
  );

  const jawaban = new Map(
    db
      .prepare('SELECT soal_id AS soalId, opsi_id AS opsiId FROM cbt_jawaban WHERE sesi_id = ?')
      .all(sesiId)
      .map((row) => [row.soalId, row.opsiId])
  );

  let benar = 0;
  let salah = 0;
  let kosong = 0;
  let bobotBenar = 0;
  let bobotTotal = 0;

  for (const item of soal) {
    bobotTotal += item.bobot;
    const dipilih = jawaban.get(item.id);

    if (dipilih == null) {
      kosong += 1;
      continue;
    }
    const isBenar = kunci.get(item.id) === dipilih;
    if (isBenar) {
      benar += 1;
      bobotBenar += item.bobot;
    } else {
      salah += 1;
    }
    db.prepare('UPDATE cbt_jawaban SET is_benar = ? WHERE sesi_id = ? AND soal_id = ?').run(
      isBenar ? 1 : 0,
      sesiId,
      item.id
    );
  }

  const skor = bobotTotal > 0 ? Math.round((bobotBenar / bobotTotal) * 1000) : 0;

  db.prepare(
    `UPDATE cbt_sesi SET
       status = @status, submit_at = datetime('now'), skor = @skor,
       jumlah_benar = @benar, jumlah_salah = @salah, jumlah_kosong = @kosong
     WHERE id = @id`
  ).run({ id: sesiId, status: statusAkhir, skor, benar, salah, kosong });

  return { skor, benar, salah, kosong, totalSoal: soal.length };
});

router.post(
  '/sesi/:sesiId/submit',
  requirePeserta,
  asyncHandler((req, res) => {
    const sesi = sesiMilikPeserta(req.params.sesiId, req.peserta.id);
    if (sesi.status !== 'berjalan') throw forbidden('Sesi ini sudah dikumpulkan sebelumnya.');

    const hasil = nilaiSesi(sesi.id, 'selesai');
    return ok(res, { sesiId: sesi.id, status: 'selesai', ...hasil });
  })
);

router.get(
  '/hasil',
  requirePeserta,
  asyncHandler((req, res) => {
    const rows = db
      .prepare(
        `SELECT s.id AS sesiId, p.nama AS paket, p.kode AS kodePaket, s.percobaan,
                s.submit_at AS submitAt, s.status, s.skor,
                s.jumlah_benar AS benar, s.jumlah_salah AS salah, s.jumlah_kosong AS kosong,
                p.jumlah_soal AS totalSoal,
                (SELECT COUNT(*) + 1 FROM cbt_sesi x
                  WHERE x.paket_id = s.paket_id AND x.status = 'selesai'
                    AND x.skor > s.skor) AS peringkat,
                (SELECT COUNT(*) FROM cbt_sesi x
                  WHERE x.paket_id = s.paket_id AND x.status = 'selesai') AS totalPeserta
         FROM cbt_sesi s
         JOIN cbt_paket p ON p.id = s.paket_id
         WHERE s.peserta_id = ? AND s.status IN ('selesai','kedaluwarsa')
         ORDER BY s.submit_at DESC`
      )
      .all(req.peserta.id);

    return ok(res, rows);
  })
);

module.exports = router;
