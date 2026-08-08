/**
 * Notifikasi keluar: Email (Nodemailer/SendGrid) dan WhatsApp (gateway pihak ketiga).
 *
 * Prinsip:
 *  1. **Tidak pernah memblokir pengguna.** Semua fungsi publik di berkas ini
 *     mengembalikan Promise yang sudah "ditangkap"; kegagalan kirim hanya dicatat
 *     di tabel `notifikasi_log`, tidak pernah membuat permintaan pelapor gagal.
 *  2. **Mati secara diam-diam bila belum dikonfigurasi.** Tanpa SMTP_HOST atau
 *     WA_API_URL, pengiriman dilewati dan dicatat berstatus 'dilewati' — sehingga
 *     pengembangan lokal tidak perlu kredensial apa pun.
 *  3. **Dependensi dimuat malas.** `nodemailer` hanya di-require ketika email
 *     benar-benar dikirim, agar server tetap jalan bila paket belum dipasang.
 *
 * Konfigurasi ada di .env — lihat .env.example bagian "Integrasi".
 */
const { db } = require('./db');

const cfg = () => ({
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  mailFrom: process.env.MAIL_FROM || 'PR PMII Saintek <no-reply@pmiiuinsgd.site>',
  advokasiEmail: process.env.ADVOKASI_NOTIFY_EMAIL,
  mapabaEmail: process.env.MAPABA_NOTIFY_EMAIL,
  waApiUrl: process.env.WA_API_URL,
  waApiToken: process.env.WA_API_TOKEN,
  waAdmin: process.env.WA_ADMIN_NUMBER,
  situs: process.env.SITE_URL || 'https://www.pmiiuinsgd.site',
});

function catat(kanal, tujuan, perihal, entitas, entitasId, status, galat) {
  try {
    db.prepare(
      `INSERT INTO notifikasi_log (kanal, tujuan, perihal, entitas, entitas_id, status, galat)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(kanal, tujuan, perihal ?? null, entitas ?? null, entitasId ?? null, status, galat ?? null);
  } catch (error) {
    console.error('[notify] gagal menulis notifikasi_log:', error.message);
  }
}

/* ------------------------------------------------------------------- Email */

let transporterCache = null;

/**
 * Transporter Nodemailer.
 *
 * Untuk SendGrid, cukup isi .env dengan:
 *   SMTP_HOST=smtp.sendgrid.net
 *   SMTP_PORT=587
 *   SMTP_USER=apikey            (harfiah, kata "apikey")
 *   SMTP_PASS=SG.xxxxxxxx       (API key SendGrid)
 *
 * Untuk Gmail, gunakan App Password, bukan kata sandi akun.
 */
function transporter() {
  const c = cfg();
  if (!c.smtpHost) return null;
  if (transporterCache) return transporterCache;

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.warn('[notify] paket "nodemailer" belum dipasang — email dilewati.');
    return null;
  }

  transporterCache = nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpPort === 465, // 465 = SMTPS implisit, 587 = STARTTLS
    auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPass } : undefined,
    pool: true,
    maxConnections: 2,
  });

  return transporterCache;
}

async function kirimEmail({ to, subject, html, text, entitas, entitasId }) {
  if (!to) return;

  const t = transporter();
  if (!t) {
    catat('email', to, subject, entitas, entitasId, 'dilewati', 'SMTP belum dikonfigurasi');
    return;
  }

  try {
    await t.sendMail({ from: cfg().mailFrom, to, subject, text, html });
    catat('email', to, subject, entitas, entitasId, 'terkirim');
  } catch (error) {
    console.error('[notify] gagal mengirim email:', error.message);
    catat('email', to, subject, entitas, entitasId, 'gagal', error.message);
  }
}

/* ---------------------------------------------------------------- WhatsApp */

/**
 * Kirim pesan WhatsApp lewat gateway HTTP pihak ketiga.
 *
 * Format permintaan mengikuti Fonnte (fonnte.com) yang paling umum dipakai di
 * Indonesia: POST dengan header `Authorization: <token>` dan body
 * `{ target, message }`. Untuk Wablas/Watzap, cukup sesuaikan `WA_API_URL` dan
 * bentuk body di bawah — sisanya tidak berubah.
 */
async function kirimWhatsApp({ to, message, entitas, entitasId }) {
  const c = cfg();
  const tujuan = to || c.waAdmin;

  if (!c.waApiUrl || !tujuan) {
    catat('whatsapp', tujuan || '-', null, entitas, entitasId, 'dilewati', 'Gateway WA belum dikonfigurasi');
    return;
  }

  try {
    const response = await fetch(c.waApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: c.waApiToken || '',
      },
      body: JSON.stringify({ target: tujuan, message, countryCode: '62' }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw new Error(`Gateway membalas HTTP ${response.status}`);
    catat('whatsapp', tujuan, null, entitas, entitasId, 'terkirim');
  } catch (error) {
    console.error('[notify] gagal mengirim WhatsApp:', error.message);
    catat('whatsapp', tujuan, null, entitas, entitasId, 'gagal', error.message);
  }
}

/* --------------------------------------------------------- Templat pesan */

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);

const KATEGORI_LABEL = {
  akademik: 'Akademik',
  fasilitas: 'Fasilitas Kampus',
  kekerasan_seksual: 'Kekerasan / Pelecehan',
  ukt: 'UKT / Biaya Pendidikan',
  perundungan: 'Perundungan / Intimidasi',
  kebebasan_berpendapat: 'Kebebasan Berpendapat',
  ketenagakerjaan: 'Ketenagakerjaan / Magang',
  lainnya: 'Lainnya',
};

function layoutEmail(judul, isi) {
  return `<!DOCTYPE html><html lang="id"><body style="margin:0;background:#f1f5f9;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#0b1a5c;padding:20px 24px">
      <p style="margin:0;color:#fff;font-size:16px;font-weight:700">PR PMII Saintek UIN SGD</p>
      <p style="margin:4px 0 0;color:#ffdb4a;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Dzikir, Fikir, Amal Sholeh</p>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 16px;font-size:18px;color:#0b1a5c">${escapeHtml(judul)}</h1>
      ${isi}
    </div>
    <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;color:#64748b;font-size:12px">Pesan otomatis dari sistem website. Mohon jangan membalas email ini.</p>
    </div>
  </div></body></html>`;
}

const baris = (label, nilai) =>
  `<p style="margin:0 0 8px;font-size:14px;color:#334155"><strong style="color:#0b1a5c">${escapeHtml(label)}:</strong> ${escapeHtml(nilai)}</p>`;

/* ------------------------------------------------------- Pemicu notifikasi */

/**
 * Pengaduan advokasi baru.
 *
 * Dua kanal dipakai bersamaan untuk kasus mendesak (kekerasan/pelecehan,
 * perundungan): email berisi rincian lengkap, WhatsApp berisi ringkasan agar
 * pengurus piket langsung melihatnya di ponsel.
 */
function notifikasiPengaduanBaru(pengaduan) {
  const c = cfg();
  const label = KATEGORI_LABEL[pengaduan.kategori] || pengaduan.kategori;
  const judul = pengaduan.mendesak
    ? `[MENDESAK] Pengaduan baru ${pengaduan.nomorTiket}`
    : `Pengaduan baru ${pengaduan.nomorTiket}`;

  const isi =
    baris('Nomor tiket', pengaduan.nomorTiket) +
    baris('Kategori', label) +
    baris('Prioritas', pengaduan.prioritas) +
    baris('Pelapor', pengaduan.nama) +
    baris('Kontak', pengaduan.kontak) +
    `<div style="margin-top:16px;padding:14px;background:#f8fafc;border-left:3px solid #ffc820;border-radius:6px">
       <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#64748b">Kronologi</p>
       <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap">${escapeHtml(
         pengaduan.kronologi.slice(0, 1500)
       )}</p>
     </div>
     <p style="margin:20px 0 0"><a href="${c.situs}/admin/advokasi.html" style="display:inline-block;background:#1829b6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Buka di Dashboard</a></p>`;

  // Sengaja tidak di-await: pemanggil tidak boleh menunggu jaringan.
  kirimEmail({
    to: c.advokasiEmail,
    subject: judul,
    html: layoutEmail(judul, isi),
    text: `${judul}\nKategori: ${label}\nPelapor: ${pengaduan.nama}\nKontak: ${pengaduan.kontak}\n\n${pengaduan.kronologi}`,
    entitas: 'pengaduan',
    entitasId: pengaduan.id,
  });

  if (pengaduan.mendesak) {
    kirimWhatsApp({
      message:
        `🚨 *PENGADUAN MENDESAK*\n\n` +
        `Tiket: ${pengaduan.nomorTiket}\n` +
        `Kategori: ${label}\n` +
        `Pelapor: ${pengaduan.nama}\n` +
        `Kontak: ${pengaduan.kontak}\n\n` +
        `Mohon segera ditindaklanjuti melalui dashboard advokasi.`,
      entitas: 'pengaduan',
      entitasId: pengaduan.id,
    });
  }
}

/** Pendaftar MAPABA baru: email ke panitia + WhatsApp ucapan ke pendaftar. */
function notifikasiPendaftarMapaba(pendaftar) {
  const c = cfg();
  const judul = `Pendaftar MAPABA baru — ${pendaftar.namaLengkap}`;

  const isi =
    baris('Nomor registrasi', pendaftar.nomorRegistrasi) +
    baris('Nama', pendaftar.namaLengkap) +
    baris('NIM', pendaftar.nim) +
    baris('Fakultas / Prodi', `${pendaftar.fakultas} — ${pendaftar.prodi}`) +
    baris('Angkatan', String(pendaftar.angkatan)) +
    baris('WhatsApp', pendaftar.whatsapp) +
    baris('Email', pendaftar.email) +
    `<p style="margin:20px 0 0"><a href="${c.situs}/admin/mapaba.html" style="display:inline-block;background:#1829b6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Verifikasi Pendaftar</a></p>`;

  kirimEmail({
    to: c.mapabaEmail || c.advokasiEmail,
    subject: judul,
    html: layoutEmail(judul, isi),
    text: `${judul}\nRegistrasi: ${pendaftar.nomorRegistrasi}\nNIM: ${pendaftar.nim}\nWA: ${pendaftar.whatsapp}`,
    entitas: 'mapaba_pendaftar',
    entitasId: pendaftar.id,
  });

  kirimWhatsApp({
    to: pendaftar.whatsapp,
    message:
      `Salam Pergerakan, ${pendaftar.namaLengkap}!\n\n` +
      `Pendaftaran MAPABA Raya kamu sudah kami terima.\n` +
      `Nomor registrasi: *${pendaftar.nomorRegistrasi}*\n\n` +
      `Simpan nomor ini. Panitia akan menghubungimu untuk verifikasi berkas dan ` +
      `mengirimkan tautan grup peserta.\n\n_PR PMII Saintek UIN SGD_`,
    entitas: 'mapaba_pendaftar',
    entitasId: pendaftar.id,
  });
}

/** Pemberitahuan hasil verifikasi (diterima/ditolak) ke pendaftar. */
function notifikasiStatusMapaba(pendaftar, status, catatan) {
  const diterima = status === 'terverifikasi';
  const judul = diterima
    ? 'Pendaftaran MAPABA kamu DITERIMA'
    : 'Kabar mengenai pendaftaran MAPABA kamu';

  const isi =
    baris('Nomor registrasi', pendaftar.nomor_registrasi) +
    baris('Status', diterima ? 'Diterima / terverifikasi' : 'Belum dapat diterima') +
    (catatan ? baris('Catatan panitia', catatan) : '') +
    `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#334155">${
      diterima
        ? 'Sampai jumpa di lokasi kegiatan. Petunjuk teknis dan tautan grup peserta akan dikirim melalui WhatsApp.'
        : 'Terima kasih atas minatmu. Silakan hubungi panitia bila ingin menanyakan alasannya lebih lanjut.'
    }</p>`;

  kirimEmail({
    to: pendaftar.email,
    subject: judul,
    html: layoutEmail(judul, isi),
    text: `${judul}\nRegistrasi: ${pendaftar.nomor_registrasi}`,
    entitas: 'mapaba_pendaftar',
    entitasId: pendaftar.id,
  });

  kirimWhatsApp({
    to: pendaftar.whatsapp,
    message: diterima
      ? `Salam Pergerakan, ${pendaftar.nama_lengkap}!\n\nPendaftaran MAPABA kamu (*${pendaftar.nomor_registrasi}*) telah *DITERIMA*. Sampai jumpa di lokasi kegiatan!`
      : `Salam Pergerakan, ${pendaftar.nama_lengkap}. Ada kabar mengenai pendaftaran MAPABA kamu (${pendaftar.nomor_registrasi}). Silakan hubungi panitia untuk informasi lebih lanjut.`,
    entitas: 'mapaba_pendaftar',
    entitasId: pendaftar.id,
  });
}

module.exports = {
  kirimEmail,
  kirimWhatsApp,
  notifikasiPengaduanBaru,
  notifikasiPendaftarMapaba,
  notifikasiStatusMapaba,
};
