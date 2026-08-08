/**
 * Penyimpanan berkas dengan driver yang dapat ditukar.
 *
 *   STORAGE_DRIVER=local       simpan di server/uploads (hanya untuk pengembangan)
 *   STORAGE_DRIVER=s3          AWS S3 / Cloudflare R2 / MinIO / IDCloudHost Object Storage
 *   STORAGE_DRIVER=cloudinary  Cloudinary (punya transformasi & CDN bawaan)
 *
 * Semua driver mengembalikan bentuk yang sama:
 *   { driver, kunci, url, mime, ukuranByte, namaAsli }
 *
 * Mengapa bukan penyimpanan lokal di produksi: berkas ikut hilang setiap kali
 * kontainer/VPS dibuat ulang, tidak terdistribusi bila server ditambah, dan
 * setiap permintaan gambar membebani proses Node yang seharusnya melayani API
 * (terutama saat ratusan peserta CBT mengakses bersamaan).
 *
 * Paket SDK dimuat malas (lazy require) supaya `npm install` dasar tetap ringan;
 * pasang hanya yang dipakai:
 *   npm install @aws-sdk/client-s3      # driver s3
 *   npm install cloudinary              # driver cloudinary
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

/** Nama berkas acak agar tidak bisa ditebak dan tidak bentrok. */
function buatKunci(tujuan, namaAsli) {
  const ext = (path.extname(namaAsli || '') || '').toLowerCase().slice(0, 10);
  const acak = crypto.randomBytes(12).toString('hex');
  const tanggal = new Date().toISOString().slice(0, 10);
  return `${tujuan}/${tanggal}/${acak}${ext}`;
}

/* ------------------------------------------------------------------ local */

async function simpanLocal(file, tujuan) {
  const kunci = buatKunci(tujuan, file.originalname);
  const target = path.join(UPLOAD_DIR, kunci);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, file.buffer);

  return {
    driver: 'local',
    kunci,
    url: `${PUBLIC_BASE_URL}/uploads/${kunci}`,
    mime: file.mimetype,
    ukuranByte: file.size,
    namaAsli: file.originalname,
  };
}

async function hapusLocal(kunci) {
  await fs.promises.rm(path.join(UPLOAD_DIR, kunci), { force: true });
}

/* --------------------------------------------------------------------- S3 */

let s3Client = null;

function getS3() {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');

  s3Client = new S3Client({
    region: process.env.S3_REGION || 'ap-southeast-1',
    // endpoint diisi bila memakai Cloudflare R2, MinIO, atau object storage lokal
    ...(process.env.S3_ENDPOINT
      ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

async function simpanS3(file, tujuan) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET belum diisi di .env');

  const kunci = buatKunci(tujuan, file.originalname);

  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: kunci,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
      // Berkas MAPABA (pas foto & KTM) adalah data pribadi: simpan privat dan
      // sajikan lewat presigned URL. Aset galeri/artikel boleh publik.
      ...(tujuan === 'mapaba' ? {} : { ACL: 'public-read' }),
    })
  );

  const cdn = process.env.S3_PUBLIC_URL?.replace(/\/$/, '');
  const url = cdn
    ? `${cdn}/${kunci}`
    : `https://${bucket}.s3.${process.env.S3_REGION || 'ap-southeast-1'}.amazonaws.com/${kunci}`;

  return {
    driver: 's3',
    kunci,
    url,
    mime: file.mimetype,
    ukuranByte: file.size,
    namaAsli: file.originalname,
  };
}

async function hapusS3(kunci) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getS3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: kunci }));
}

/**
 * URL bertanda tangan berumur pendek untuk berkas privat (pas foto & KTM).
 * Dipakai panel admin agar dokumen pribadi tidak dapat diakses sembarang orang
 * yang menebak URL-nya.
 */
async function presignedUrl(kunci, detik = 300) {
  if (DRIVER !== 's3') return null;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: kunci }),
    { expiresIn: detik }
  );
}

/* ------------------------------------------------------------- Cloudinary */

function getCloudinary() {
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  return cloudinary;
}

async function simpanCloudinary(file, tujuan) {
  const cloudinary = getCloudinary();

  const hasil = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `pmii-uinsgd/${tujuan}`,
        resource_type: 'auto',
        // Kompresi & konversi format otomatis — inti dari optimasi galeri:
        // Cloudinary mengirim WebP/AVIF ke peramban yang mendukungnya.
        transformation:
          tujuan === 'galeri' || tujuan === 'artikel'
            ? [{ quality: 'auto:good', fetch_format: 'auto', width: 1600, crop: 'limit' }]
            : [{ quality: 'auto:good', fetch_format: 'auto', width: 1000, crop: 'limit' }],
        type: tujuan === 'mapaba' ? 'authenticated' : 'upload',
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(file.buffer);
  });

  return {
    driver: 'cloudinary',
    kunci: hasil.public_id,
    url: hasil.secure_url,
    mime: file.mimetype,
    ukuranByte: hasil.bytes ?? file.size,
    namaAsli: file.originalname,
  };
}

async function hapusCloudinary(kunci) {
  await getCloudinary().uploader.destroy(kunci);
}

/* -------------------------------------------------------------- Antarmuka */

const DRIVERS = {
  local: { simpan: simpanLocal, hapus: hapusLocal },
  s3: { simpan: simpanS3, hapus: hapusS3 },
  cloudinary: { simpan: simpanCloudinary, hapus: hapusCloudinary },
};

function aktif() {
  const driver = DRIVERS[DRIVER];
  if (!driver) throw new Error(`STORAGE_DRIVER "${DRIVER}" tidak dikenal.`);
  return driver;
}

const simpanBerkas = (file, tujuan = 'umum') => aktif().simpan(file, tujuan);
const hapusBerkas = (kunci) => aktif().hapus(kunci);

module.exports = { simpanBerkas, hapusBerkas, presignedUrl, DRIVER, UPLOAD_DIR };
