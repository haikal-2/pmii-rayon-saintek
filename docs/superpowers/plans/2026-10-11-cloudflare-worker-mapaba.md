# Cloudflare Worker + MAPABA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan backend Cloudflare Worker untuk MAPABA dengan D1, upload Cloudinary privat, autentikasi admin transisi, dan kontrak frontend yang tetap kompatibel; Express tetap melayani layanan lain.

**Architecture:** Worker mandiri di `worker/` memakai Web APIs, D1, dan modul JavaScript kecil. Frontend memilih URL Worker hanya untuk request MAPABA; login lama dan layanan Express lain tidak berubah. File privat hanya dapat diunduh melalui proxy Worker setelah pemeriksaan token.

**Tech Stack:** Cloudflare Workers, Wrangler, D1, Vitest + `@cloudflare/vitest-pool-workers`, Zod, Cloudinary Upload/Delivery API, Resend HTTP API, JavaScript, Node.js test runner untuk tes frontend.

**Spec:** [Desain Migrasi Backend Website ke Cloudflare Workers](../specs/2026-10-11-cloudflare-worker-backend-design.md)

## Global Constraints

- Worker ditempatkan pada direktori `worker/` sebagai aplikasi terpisah dari aplikasi Express dan proses build frontend.
- Express tetap melayani endpoint website selain MAPABA sampai masing-masing layanan dipindahkan dalam tahap berikutnya.
- Hanya permintaan MAPABA dan upload berkas MAPABA yang diarahkan ke Worker pada tahap pertama.
- Cloudflare Worker menggunakan Web APIs bawaan (`fetch`, `Request`, `Response`, `FormData`, dan Web Crypto) serta router JavaScript kecil tanpa ketergantungan pada server HTTP Node.
- CORS hanya mengizinkan origin frontend lokal dan origin deploy yang dikonfigurasi. Origin wildcard tidak digunakan.
- D1 dimulai kosong dan tidak mengimpor isi SQLite.
- Kontrak request mempertahankan field MAPABA yang tercantum di spesifikasi; validasi memakai nama field tersebut pada `errors`.
- Token `ADMIN_TOKEN` hanya disimpan di `sessionStorage`, dikirim melalui header Bearer, dan dihapus saat logout.
- Upload hanya menerima JPEG/PNG/WebP maksimal 3 MB dengan pemeriksaan MIME dan magic bytes.
- Pendaftaran dibatasi maksimal 10 permintaan per IP per jam dan upload maksimal 20 permintaan per IP per 15 menit.
- Email opsional menggunakan Resend HTTP; Google Sheets dan WhatsApp tetap memakai endpoint HTTP yang dapat dikonfigurasi.
- Nilai rahasia Cloudinary, Resend, CAPTCHA, token admin, dan kunci hashing pembatasan laju tidak boleh ditulis pada source code atau konfigurasi publik.
- Tidak ada deploy produksi maupun impor data produksi selama implementasi dan pengujian lokal.

## Review Focus

- Origin frontend yang tidak diizinkan atau header `Origin` yang hilang: uji CORS untuk preflight, origin allowlist, origin terlarang, dan permintaan server-ke-server tanpa `Origin` pada Task 1.
- Database tanpa gelombang aktif, pendaftaran sebelum/sesudah tenggat, kuota penuh, dan request serentak: uji 404/400/409 serta tidak ada baris berlebih pada Task 5.
- URL file arbitrer, referensi upload yang belum terpakai, MIME palsu, dan magic bytes salah: uji penolakan tanpa mengklaim file atau menghubungi Cloudinary pada Task 4 dan Task 5.
- Token Worker hilang/salah dan unduhan berkas tanpa autentikasi: uji 401, tidak ada fetch ke Cloudinary, serta pembersihan token pada logout pada Task 6 dan Task 7.
- Kegagalan jaringan Cloudinary/CAPTCHA/Resend/WhatsApp/Sheets: uji respons yang aman, aturan fail-open CAPTCHA yang mengikuti konfigurasi, dan pendaftaran tersimpan walau notifikasi gagal pada Task 3–Task 5.

---

## File Structure

### Worker baru

- `worker/package.json` dan `worker/package-lock.json` — dependensi dan perintah Worker terisolasi.
- `worker/wrangler.jsonc` — entry point, binding D1, migration directory, dan konfigurasi non-secret.
- `worker/vitest.config.js` — lingkungan Vitest untuk Worker dan D1 lokal.
- `worker/.dev.vars.example` — daftar nama variabel lokal; tanpa nilai secret sungguhan.
- `worker/src/index.js` — handler `fetch`, CORS, routing, dan format galat.
- `worker/src/lib/http.js` — pembuat respons JSON dan galat API.
- `worker/src/lib/db.js` — operasi D1 MAPABA.
- `worker/src/lib/security.js` — verifikasi admin, CAPTCHA, dan rate limit berbasis hash IP.
- `worker/src/lib/validation.js` — skema Zod untuk MAPABA, filter admin, dan unggahan.
- `worker/src/lib/cloudinary.js` — upload privat dan pengambilan aset privat dari Cloudinary.
- `worker/src/lib/notifications.js` — Resend, WhatsApp, Sheets, dan pencatatan hasil.
- `worker/src/routes/mapaba.js` — endpoint MAPABA publik.
- `worker/src/routes/mapaba-admin.js` — daftar, ubah status, dan proxy berkas admin.
- `worker/src/routes/upload.js` — upload pas foto/KTM.
- `worker/migrations/0001_init.sql` — tabel, constraint, dan indeks D1.
- `worker/seeds/local.sql` — gelombang contoh lokal, tidak diterapkan otomatis ke produksi.
- `worker/test/` — tes Worker lokal dengan D1 dan fetch provider tiruan.

### File lama yang diubah

- `.gitignore` — abaikan `worker/.dev.vars`.
- `public/assets/js/config.js` — tambah `mapabaApiBaseUrl`, pertahankan `apiBaseUrl`.
- `public/assets/js/forms.js` — pilih Worker untuk route MAPABA saja.
- `public/assets/js/uploader.js` — pilih endpoint dari atribut konfigurasi uploader.
- `public/assets/js/admin-mapaba.js` — simpan token Worker sementara, panggil route Worker, dan unduh file lewat fetch berotorisasi.
- `public/assets/js/admin.js` — hapus token Worker saat logout panel.
- `src/pages/mapaba.html` — tandai uploader MAPABA agar menggunakan Worker.
- `src/pages/admin-mapaba.html` — form token Worker dan markup status akses berkas.
- `server/test/mapaba-form.test.js` — tes pemilihan API untuk MAPABA tanpa mengubah layanan Express.
- `docs/BACKEND-SPEC.md` dan `docs/DEPLOYMENT.md` — kontrak dua backend dan prosedur Worker/D1/Cloudinary.

## Task 1: Menyiapkan Runtime Worker, Respons HTTP, dan CORS

**Files:**
- Create: `worker/package.json`
- Create: `worker/wrangler.jsonc`
- Create: `worker/vitest.config.js`
- Create: `worker/.dev.vars.example`
- Create: `worker/src/index.js`
- Create: `worker/src/lib/http.js`
- Create: `worker/test/index.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `default.fetch(request, env, ctx)` sebagai entry point Cloudflare Worker.
- Produces: `jsonResponse(data, status = 200, meta)` dan `errorResponse(status, message, errors)` dari `src/lib/http.js`.
- Produces: `GET /api/v1/health` dengan respons `{ ok: true, data: { status: "sehat" } }`.
- Produces: semua route berikutnya dipasang di `src/index.js` tanpa membuat listener Node.

- [ ] **Step 1: Tambahkan konfigurasi test dan Worker**

Tambahkan `worker/package.json` dengan `"type": "module"`, script `"dev": "wrangler dev --local"`, `"test": "vitest run"`, dan `"db:migrate:local": "wrangler d1 migrations apply pmii-rayon-saintek --local"`, serta dependency `zod` dan devDependencies `wrangler`, `vitest`, dan `@cloudflare/vitest-pool-workers`. Pakai versi kompatibel yang didukung registry saat task dijalankan. Tambahkan konfigurasi Vitest pool Workers yang membaca `worker/wrangler.jsonc`.

Konfigurasikan `wrangler.jsonc` memakai `src/index.js`, compatibility date `2026-10-11`, binding D1 bernama `DB`, nama database `pmii-rayon-saintek`, `database_id` lokal `"00000000-0000-0000-0000-000000000000"`, dan migration directory `migrations`. Dokumentasikan bahwa pengelola harus mengganti ID tersebut dengan D1 database ID sebelum deploy. Jangan menambahkan binding R2 atau `nodejs_compat`.

- [ ] **Step 2: Pasang dependency Worker**

Run: `npm install --prefix worker`
Expected: `worker/package-lock.json` dibuat dan semua dependency Worker berhasil dipasang tanpa mengubah `package-lock.json` root.

- [ ] **Step 3: Tulis tes awal handler dan CORS**

Tambahkan ke `worker/test/index.test.js` tes `SELF.fetch('http://example.test/api/v1/health')` yang mengharapkan HTTP 200 dan body `data.status === 'sehat'`. Tambahkan preflight dari origin allowlist untuk method `PATCH` dan header `authorization,content-type`; pastikan response mengizinkan `GET,POST,PATCH,OPTIONS` dan hanya header yang diperlukan. Tambahkan request dari origin lain yang harus ditolak.

- [ ] **Step 4: Jalankan tes untuk memastikan gagal**

Run: `npm --prefix worker test -- test/index.test.js`
Expected: gagal karena entry point Worker dan route health belum mengembalikan kontrak yang diminta.

- [ ] **Step 5: Implementasikan response helper, router minimal, dan CORS**

Implementasikan `jsonResponse`, `errorResponse`, allowlist origin dari `CORS_ORIGINS`, handler OPTIONS dengan method `GET,POST,PATCH,OPTIONS` dan header `Authorization,Content-Type`, route health, serta respons JSON `404` untuk route tidak dikenal. Permintaan tanpa `Origin` diizinkan untuk health check/server-to-server; origin browser yang tidak terdaftar mendapat `403`. Jangan menambahkan wildcard origin atau `Access-Control-Allow-Credentials`.

- [ ] **Step 6: Jalankan tes Task 1**

Run: `npm --prefix worker test -- test/index.test.js`
Expected: semua tes health, preflight, origin terlarang, request tanpa Origin, dan 404 lulus.

- [ ] **Step 7: Abaikan file dev secret**

Tambahkan baris `worker/.dev.vars` ke `.gitignore`; pastikan `worker/.dev.vars.example` tetap dilacak dan hanya berisi nama variabel serta nilai kosong/contoh non-rahasia.

Run: `git check-ignore worker/.dev.vars`
Expected: perintah menampilkan `worker/.dev.vars`.

- [ ] **Step 8: Commit**

```powershell
git add .gitignore worker/package.json worker/package-lock.json worker/wrangler.jsonc worker/vitest.config.js worker/.dev.vars.example worker/src/index.js worker/src/lib/http.js worker/test/index.test.js
git commit -m "feat(worker): scaffold Cloudflare Worker API" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Menambahkan Skema D1 dan Repository MAPABA

**Files:**
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/seeds/local.sql`
- Create: `worker/src/lib/db.js`
- Create: `worker/test/db.test.js`
- Modify: `worker/package.json`

**Interfaces:**
- Consumes: binding D1 `env.DB` dari Task 1.
- Produces: `getActiveWave(db, now)`, `getRegistrationByNumber(db, nomor)`, `getUpload(db, id)`, `listRegistrations(db, filters)`, dan `updateRegistration(db, id, changes, actor)`.
- Produces: tabel `mapaba_gelombang`, `mapaba_pendaftar`, `counters`, `mapaba_uploads`, `rate_limit_buckets`, `audit_log`, dan `notification_log`.

- [ ] **Step 1: Tulis tes repository D1**

Di `worker/test/db.test.js`, impor `env` dari `cloudflare:test` dan `expect`/`it` dari Vitest; siapkan helper fixture lokal `insertFixtureRegistration()`; tes bahwa gelombang aktif dapat dibaca, satu pendaftar fixture dapat disimpan, `(gelombang_id, nim)` menolak duplikasi, dan query status publik memilih hanya nomor registrasi, nama, fakultas, prodi, status, serta waktu pendaftaran.

Contoh assertion:

```js
const row = await getRegistrationByNumber(env.DB, 'MPB-2026-0001');
expect(row).toMatchObject({ nomorRegistrasi: 'MPB-2026-0001', status: 'menunggu' });
expect(row).not.toHaveProperty('nim');
expect(row).not.toHaveProperty('email');
```

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `npm --prefix worker test -- test/db.test.js`
Expected: gagal karena migration dan fungsi repository D1 belum ada.

- [ ] **Step 3: Buat migration D1**

Buat tabel gelombang dengan field yang cocok dengan `server/db/schema.sql`; tabel pendaftar memuat seluruh field formulir, `pas_foto_id`/`ktm_id` sebagai foreign key ke `mapaba_uploads`, foreign key `gelombang_id`, status `CHECK`, dan `UNIQUE(gelombang_id, nim)`. Simpan relasi foto/KTM sebagai ID internal, bukan URL Cloudinary.

Tambahkan `counters(nama, tahun, nilai)` dengan primary key gabungan `(nama, tahun)`, `mapaba_uploads(id, cloudinary_public_id, format, mime, ukuran_byte, created_at, claimed_at)`, `rate_limit_buckets(scope, ip_hash, window_start, count)` dengan primary key gabungan `(scope, ip_hash, window_start)`, `audit_log(id, actor, action, entity, entity_id, metadata, created_at)`, dan `notification_log(id, channel, destination, subject, entity, entity_id, status, error, created_at)`. Batasi kanal notifikasi ke `email`, `whatsapp`, `google_sheets` dan status ke `terkirim`, `gagal`, `dilewati`. `destination` hanya menyimpan recipient/label aman, bukan URL webhook atau token provider; `error` tidak boleh berisi secret. Gunakan primary key opaque untuk ID upload, unique constraint pada Cloudinary public ID, dan conditional claim `claimed_at IS NULL` dalam batch D1 agar satu upload hanya dapat dipakai sekali. Tambahkan indeks gelombang/status/tanggal.

- [ ] **Step 4: Buat seed lokal eksplisit**

Isi `worker/seeds/local.sql` dengan satu gelombang pengujian berkuota kecil. Tambahkan script `"db:seed:local": "wrangler d1 execute pmii-rayon-saintek --local --file=seeds/local.sql"` di `worker/package.json`. Jangan memasukkan seed SQL ke direktori migrations dan jangan menambahkan data gelombang produksi.

- [ ] **Step 5: Implementasikan operasi baca/tulis D1**

Implementasikan fungsi yang disebut di bagian Interfaces dengan prepared statements. `getRegistrationByNumber` harus memilih kolom publik minimum, `listRegistrations` harus membatasi `limit` maksimum 200 dan memakai parameter binding, dan `updateRegistration` harus mencatat audit tanpa menyimpan token Bearer sebagai aktor.

- [ ] **Step 6: Jalankan tes repository**

Run: `npm --prefix worker test -- test/db.test.js`
Expected: tes gelombang, unique NIM, proyeksi data publik, filter daftar, dan audit lulus.

- [ ] **Step 7: Commit**

```powershell
git add worker/package.json worker/package-lock.json worker/migrations/0001_init.sql worker/seeds/local.sql worker/src/lib/db.js worker/test/db.test.js
git commit -m "feat(worker): add MAPABA D1 schema" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Menambahkan Validasi, Token Admin, CAPTCHA, dan Rate Limit

**Files:**
- Create: `worker/src/lib/validation.js`
- Create: `worker/src/lib/security.js`
- Create: `worker/test/security.test.js`
- Modify: `worker/src/index.js`
- Modify: `worker/.dev.vars.example`

**Interfaces:**
- Consumes: `errorResponse` dan binding D1 dari Task 1–2.
- Produces: `validateRegistration(input)`, `validateAdminQuery(query)`, `validateStatusChange(input)`, `authenticateAdmin(request, env)`, `checkRateLimit(env, scope, clientIp, max, windowSeconds)`, dan `verifyCaptcha(token, request, env)`.
- `authenticateAdmin` mengembalikan `true` hanya bila header Bearer valid; semua route admin selanjutnya menghasilkan `401` bila `false`.
- `checkRateLimit` mengembalikan `{ allowed: boolean, retryAfter: number }` dan melempar galat internal jika D1 gagal.
- `verifyCaptcha` mengembalikan sukses untuk provider `none`, atau menolak berdasarkan provider/secret/hasil verifikasi dan kebijakan fail-open yang dikonfigurasi.

- [ ] **Step 1: Tulis tes validasi dan keamanan**

Tambahkan tes input pendaftaran untuk NIM non-digit/terlalu pendek, email salah, motivasi di bawah 30 karakter, persetujuan tidak dicentang, status admin di luar enum, token admin hilang/salah, CAPTCHA provider aktif tanpa secret, CAPTCHA token gagal, serta counter rate limit pada batas dan setelah reset.

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `npm --prefix worker test -- test/security.test.js`
Expected: gagal karena validator dan helper keamanan belum diekspor.

- [ ] **Step 3: Implementasikan validasi Zod**

Salin batas/enum MAPABA dari `server/src/routes/mapaba.js` ke skema Zod yang kompatibel; pertahankan field opsional dan default `universitas`. Validasi upload metadata hanya mengizinkan URL referensi endpoint Worker `/api/v1/mapaba/admin/files/:id`, bukan URL eksternal atau ID yang tidak cocok.

- [ ] **Step 4: Implementasikan autentikasi constant-time**

Ambil token dari `Authorization: Bearer`; hash nilai token dan `env.ADMIN_TOKEN` dengan SHA-256 lalu bandingkan byte digest dalam loop berpanjang tetap. Token klien kosong atau format salah menghasilkan 401; `ADMIN_TOKEN`/`RATE_LIMIT_SECRET` yang tidak dikonfigurasi menghasilkan 500 dengan log aman, bukan 401 palsu. Jangan masukkan token ke body respons, log, query string, atau pesan galat.

- [ ] **Step 5: Implementasikan rate limiter dan CAPTCHA**

Gunakan `CF-Connecting-IP`, hash alamat dengan HMAC-SHA-256 memakai secret `RATE_LIMIT_SECRET`, lalu lakukan upsert atomik ke D1 berdasarkan scope/hash/window. Kegagalan D1 rate limit harus menghasilkan galat internal, tidak meloloskan request diam-diam.

Implementasikan siteverify HTTP untuk `turnstile`, `recaptcha`, dan `recaptcha3`; gunakan `CAPTCHA_SECRET_KEY`, `CAPTCHA_MIN_SCORE`, serta `CAPTCHA_FAIL_OPEN`. Provider `none` hanya melewati CAPTCHA; network failure mengikuti fail-open hanya saat konfigurasi `CAPTCHA_FAIL_OPEN=true` dan tetap dicatat.

- [ ] **Step 6: Jalankan tes keamanan**

Run: `npm --prefix worker test -- test/security.test.js`
Expected: semua kasus validasi, token, CAPTCHA, dan rate limit lulus; secret tidak muncul dalam response.

- [ ] **Step 7: Commit**

```powershell
git add worker/src/index.js worker/src/lib/validation.js worker/src/lib/security.js worker/.dev.vars.example worker/test/security.test.js
git commit -m "feat(worker): validate and protect MAPABA requests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Mengunggah dan Mem-proxy Berkas Privat Cloudinary

**Files:**
- Create: `worker/src/lib/cloudinary.js`
- Create: `worker/src/routes/upload.js`
- Create: `worker/test/upload.test.js`
- Modify: `worker/src/index.js`
- Modify: `worker/src/lib/db.js`

**Interfaces:**
- Consumes: `authenticateAdmin`, `checkRateLimit`, `errorResponse`, serta tabel upload dari Task 2–3.
- Produces: `uploadPrivateImage(env, file) -> { id, url, key, sizeBytes }`.
- Produces: `streamPrivateImage(env, uploadId) -> Response` yang hanya dipanggil setelah autentikasi admin.
- `POST /api/v1/upload` menerima multipart field `file` dan mengembalikan `data.url`, `data.kunci`, `data.ukuranByte`.
- Service proxy mengalirkan file dengan `Cache-Control: private, no-store` dan `X-Robots-Tag: noindex`; route yang memeriksa token dipasang pada Task 6.

- [ ] **Step 1: Tulis tes upload dan proxy**

Tambahkan tes upload JPEG valid dengan fetch Cloudinary tiruan; pastikan body request bertanda tangan memakai `type=authenticated` serta `resource_type=image`, tetapi response ke klien tidak berisi public ID/API secret. Tes tolak file lebih dari 3 MB, MIME tidak diizinkan, magic bytes tidak cocok, Cloudinary credential hilang, serta response provider non-2xx. Uji `streamPrivateImage` dengan respons provider tiruan dan pastikan bytes/content type diteruskan tanpa mengekspos URL provider. Pemeriksaan token dan tidak adanya fetch saat token salah diuji pada Task 6.

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `npm --prefix worker test -- test/upload.test.js`
Expected: gagal karena handler upload/proxy dan adapter Cloudinary belum ada.

- [ ] **Step 3: Implementasikan adapter Cloudinary tanpa mengirim secret ke klien**

Buat signature Upload API di Worker menggunakan parameter bertanda tangan dan `CLOUDINARY_API_SECRET`; upload dengan `type=authenticated`, `resource_type=image`, dan public ID acak. Kirim file sebagai multipart `FormData`; jangan menerima `public_id`/folder dari klien.

Jika konfigurasi hilang atau Cloudinary menolak request, kembalikan error API yang aman dan log informasi non-secret. Simpan ID internal acak serta public ID Cloudinary di D1 dan kembalikan URL Worker `/api/v1/mapaba/admin/files/{id}` sebagai referensi formulir.

- [ ] **Step 4: Implementasikan validasi file dan proxy privat**

Periksa `Content-Length` bila tersedia sebelum parse multipart, lalu cek ukuran aktual maksimal 3 MB, MIME, dan magic bytes JPEG/PNG/WebP sesudah parse. Proxy harus mencari public ID dari D1, membangun URL delivery authenticated yang ditandatangani di server, melakukan `fetch`, lalu meneruskan stream/body dan Content-Type yang sudah di-allowlist. Jangan mengirim URL Cloudinary ke browser dan jangan cache hasil proxy.

- [ ] **Step 5: Tambahkan route dan uji batas file**

Pasang route `POST /upload` dengan rate limit `20/15 menit`. Pastikan body form memiliki tepat satu file `file`; file lain/field `file` kosong menghasilkan `400`. Pada task ini proxy hanya berupa service `streamPrivateImage`; route admin yang memanggilnya dipasang pada Task 6.

- [ ] **Step 6: Jalankan tes upload**

Run: `npm --prefix worker test -- test/upload.test.js`
Expected: upload yang sah tersimpan sebagai private authenticated asset; file invalid ditolak sebelum fetch Cloudinary dan respons provider tidak membocorkan URL/secret.

- [ ] **Step 7: Commit**

```powershell
git add worker/src/lib/cloudinary.js worker/src/routes/upload.js worker/src/index.js worker/src/lib/db.js worker/test/upload.test.js
git commit -m "feat(worker): store MAPABA uploads privately" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Membuat Endpoint MAPABA Publik dan Notifikasi

**Files:**
- Create: `worker/src/routes/mapaba.js`
- Create: `worker/src/lib/notifications.js`
- Create: `worker/test/mapaba-public.test.js`
- Modify: `worker/src/index.js`
- Modify: `worker/src/lib/db.js`
- Modify: `worker/src/lib/validation.js`

**Interfaces:**
- Consumes: repository D1, validator, rate limit, CAPTCHA, dan upload references dari Task 2–4.
- Produces: `GET /api/v1/mapaba/gelombang-aktif`, `POST /api/v1/mapaba/pendaftaran`, dan `GET /api/v1/mapaba/pendaftaran/:nomor`.
- Produces: `notifyMapabaSubmission(ctx, env, registration)` dan `notifyMapabaStatus(ctx, env, registration, status, note)`, dipanggil setelah commit data.

- [ ] **Step 1: Tulis tes kontrak publik**

Tes gelombang aktif mengharapkan field `id`, `nama`, `tahun`, `bukaAt`, `tutupAt`, `mulaiAcara`, `selesaiAcara`, `lokasi`, `kuota`, `terpakai`, `sisaKuota`, `biaya`, dan `sedangDibuka`. Tes pendaftaran valid mengharapkan HTTP 201, `nomorRegistrasi` dengan pola `MPB-YYYY-NNNN`, `status: "menunggu"`, biaya, dan pesan.

Tambahkan tes tidak ada gelombang, sebelum/tutup waktu, kuota penuh, NIM duplikat, file reference eksternal/tidak dikenal, CAPTCHA gagal, serta status publik yang tidak mengembalikan NIM, kontak, motivasi, atau referensi berkas.

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `npm --prefix worker test -- test/mapaba-public.test.js`
Expected: route MAPABA belum terpasang atau belum menghasilkan kontrak yang diharapkan.

- [ ] **Step 3: Implementasikan gelombang aktif dan pelacakan publik**

`GET /mapaba/gelombang-aktif` menghitung pendaftar selain status `batal`, mengembalikan `sisaKuota = max(0, kuota - terpakai)`, dan menghasilkan 404 bila tidak ada gelombang aktif. Endpoint nomor registrasi hanya memilih kolom publik minimum.

- [ ] **Step 4: Implementasikan pendaftaran atomik**

Terapkan rate limit `10/jam`, verifikasi CAPTCHA, validasi Zod, waktu buka/tutup, dan ID upload yang terdaftar serta belum diklaim. Alokasikan counter `MPB-YYYY-NNNN`; lakukan insert bersyarat yang memeriksa gelombang aktif dan kuota pada statement D1 yang sama dengan insert. Gunakan unique `(gelombang_id, nim)` sebagai jaring terakhir dan ubah konflik menjadi `409` dengan `errors.nim`.

Klaim referensi pas foto/KTM dalam transaksi D1 yang sama. Jika dua request berlomba memakai referensi yang sama atau kuota terakhir, hanya satu yang boleh berhasil. Jangan menyimpan alamat IP mentah.

- [ ] **Step 5: Implementasikan notifikasi best-effort**

Kirim email opsional ke Resend melalui `POST https://api.resend.com/emails` dengan `RESEND_API_KEY`, `MAIL_FROM`, dan penerima yang dikonfigurasi. Kirim Sheets dan WhatsApp memakai URL/token konfigurasi masing-masing. Jalankan sesudah commit dengan `ctx.waitUntil`, catat kanal/status/galat tersanitasi ke `notification_log`, jangan simpan webhook URL/token di kolom `destination`/`error`, dan jangan menggagalkan response pendaftaran akibat kegagalan provider.

- [ ] **Step 6: Jalankan tes MAPABA publik**

Run: `npm --prefix worker test -- test/mapaba-public.test.js`
Expected: kontrak sukses/gagal tetap cocok dengan Express; semua data publik minim, kuota tidak terlampaui saat request paralel, dan kegagalan notifikasi tidak membatalkan pendaftaran.

- [ ] **Step 7: Commit**

```powershell
git add worker/src/routes/mapaba.js worker/src/lib/notifications.js worker/src/index.js worker/src/lib/db.js worker/src/lib/validation.js worker/test/mapaba-public.test.js
git commit -m "feat(worker): add public MAPABA endpoints" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Membuat Endpoint Admin MAPABA

**Files:**
- Create: `worker/src/routes/mapaba-admin.js`
- Create: `worker/test/mapaba-admin.test.js`
- Modify: `worker/src/index.js`
- Modify: `worker/src/lib/db.js`
- Modify: `worker/src/lib/notifications.js`

**Interfaces:**
- Consumes: `authenticateAdmin`, `listRegistrations`, `updateRegistration`, `streamPrivateImage`, dan notifikasi dari Task 2–5.
- Produces: `GET /api/v1/mapaba/admin/ringkasan`, `GET /api/v1/mapaba/admin/pendaftar`, `PATCH /api/v1/mapaba/admin/pendaftar/:id`, dan `GET /api/v1/mapaba/admin/files/:id`.
- Respons daftar menyertakan metadata pendaftar untuk panel admin; `pasFotoUrl`/`ktmUrl` adalah route proxy Worker, bukan Cloudinary URL.

- [ ] **Step 1: Tulis tes endpoint admin**

Tes token hilang/salah pada ringkasan, daftar, update status, dan download menghasilkan 401. Tes ringkasan memverifikasi `total`, `menunggu`, `terverifikasi`, dan `sisaKuota` dihitung dari D1 Worker. Tes query daftar memverifikasi filter `gelombangId`, `status`, `q`, `page`, `limit`, serta metadata `page`, `limit`, `total`, `totalPage`. Tes PATCH mencakup semua status yang didukung, catatan maksimal 1000 karakter, ID tidak ada (404), audit row, dan notifikasi hanya ketika status berubah menjadi `terverifikasi` atau `ditolak`.

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `npm --prefix worker test -- test/mapaba-admin.test.js`
Expected: endpoint admin gagal karena belum terpasang.

- [ ] **Step 3: Implementasikan daftar pendaftar**

Implementasikan `GET /mapaba/admin/ringkasan` dengan body sukses `{ ok: true, data: { total, menunggu, terverifikasi, sisaKuota } }` memakai agregasi D1. Tetap kembalikan statistik ketika tidak ada gelombang dan isi `sisaKuota: null`. Validasi query daftar dengan page minimal 1 dan limit 1–200. Bangun filter dengan prepared statements. Peta-kan ID upload menjadi `/api/v1/mapaba/admin/files/:id`; jangan menyertakan public ID Cloudinary atau URL provider.

- [ ] **Step 4: Implementasikan status, audit, dan notifikasi**

Validasi PATCH berisi setidaknya `status` atau `catatanPanitia`. Update status/catatan dan tulis `audit_log` dalam transaksi D1. Panggil `notifyMapabaStatus` hanya setelah perubahan status benar-benar tersimpan dan hanya saat status berubah menjadi `terverifikasi` atau `ditolak`.

- [ ] **Step 5: Implementasikan unduh proxy**

Route file memanggil `authenticateAdmin` sebelum mencari upload dan sebelum `fetch` Cloudinary. Tolak ID file yang tidak terkait pendaftar MAPABA atau tidak ditemukan dengan 404; respons bytes menggunakan `private, no-store` dan MIME yang tersimpan/di-allowlist.

- [ ] **Step 6: Jalankan tes admin**

Run: `npm --prefix worker test -- test/mapaba-admin.test.js`
Expected: admin sah dapat melihat/mengubah/mengunduh sesuai izin; token salah tidak pernah memicu query file/provider; URL dan secret Cloudinary tidak muncul pada JSON.

- [ ] **Step 7: Commit**

```powershell
git add worker/src/routes/mapaba-admin.js worker/src/index.js worker/src/lib/db.js worker/src/lib/notifications.js worker/test/mapaba-admin.test.js
git commit -m "feat(worker): add MAPABA admin routes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Mengarahkan Frontend MAPABA ke Worker

**Files:**
- Modify: `public/assets/js/config.js`
- Modify: `public/assets/js/forms.js`
- Modify: `public/assets/js/uploader.js`
- Modify: `public/assets/js/admin-mapaba.js`
- Modify: `public/assets/js/admin.js`
- Modify: `src/pages/mapaba.html`
- Modify: `src/pages/admin-mapaba.html`
- Modify: `server/test/mapaba-form.test.js`
- Create: `server/test/mapaba-worker-routing.test.js`

**Interfaces:**
- Consumes: Worker endpoint contracts dari Task 1–6.
- Produces: `window.PMII_CONFIG.mapabaApiBaseUrl`; route `/mapaba/*` memakai base Worker, route lain tetap `apiBaseUrl`.
- Produces: uploader MAPABA memakai `data-uploader-api-base`/atribut yang setara; uploader admin lama tetap memakai Express.
- Produces: `pmii_worker_admin_token` hanya untuk MAPABA admin dan dihapus oleh fungsi `PMII_ADMIN.logout()`.
- Produces: helper test `runFormSubmission(endpoint, config)` menjalankan `forms.js` dalam VM dan mengembalikan URL request yang ditangkap.
- Produces: helper test `runAdminMapabaWithToken(config, token)` menangkap request statistik/list Worker dan helper `runAdminLogout(storage)` memeriksa kedua key sesi dihapus.

- [ ] **Step 1: Tulis tes pemilihan endpoint**

Tambahkan tes VM Node pada `server/test/mapaba-worker-routing.test.js`; impor `node:test` dan `node:assert/strict`, lalu gunakan `runFormSubmission` yang didefinisikan di file yang sama untuk:

```js
const config = {
  apiBaseUrl: 'https://express.example',
  apiPrefix: '/api/v1',
  mapabaApiBaseUrl: 'https://mapaba.example',
  useMockWhenOffline: false,
};
test('uses Worker only for MAPABA endpoints', async () => {
  assert.equal(
    await runFormSubmission('/mapaba/pendaftaran', config),
    'https://mapaba.example/api/v1/mapaba/pendaftaran'
  );
  assert.equal(
    await runFormSubmission('/advokasi/pengaduan', config),
    'https://express.example/api/v1/advokasi/pengaduan'
  );
  const adminRequests = await runAdminMapabaWithToken(config, 'worker-test-token');
  assert.ok(adminRequests.some((url) => url.endsWith('/api/v1/mapaba/admin/ringkasan')));
  assert.ok(adminRequests.some((url) => url.includes('/api/v1/mapaba/admin/pendaftar')));
  assert.deepEqual(runAdminLogout({
    pmii_admin_token: 'express-token',
    pmii_admin_user: '{"role":"superadmin"}',
    pmii_worker_admin_token: 'worker-token',
  }), {});
  });
  ```

  Implementasikan `runFormSubmission` di file test dengan form mock, `fetch` spy, dan event submit; jangan menambah fungsi routing global khusus untuk mempermudah tes.
  Implementasikan `runAdminMapabaWithToken` dengan DOM mock untuk elemen statistik/tabel dan API mock yang mengembalikan ringkasan serta satu halaman kosong. Implementasikan `runAdminLogout` dengan `sessionStorage` mock, panggil `PMII_ADMIN.logout()`, lalu kembalikan key yang tersisa.

Tambahkan tes uploader yang memastikan uploader bertanda MAPABA memakai Worker sementara uploader tanpa atribut khusus tetap memakai Express.

- [ ] **Step 2: Jalankan tes untuk memastikan gagal**

Run: `node --test server/test/mapaba-worker-routing.test.js server/test/mapaba-form.test.js`
Expected: test baru gagal karena config dan pemilihan base URL Worker belum ada; test countdown/form lama tetap lulus.

- [ ] **Step 3: Tambahkan konfigurasi Worker tanpa mengubah URL lama**

Tambahkan `mapabaApiBaseUrl` pada `public/assets/js/config.js` dengan nilai kosong untuk development default; nilainya saat dikonfigurasi harus berupa origin Worker saja, tanpa `/api/v1` atau slash akhir. Pertahankan `apiBaseUrl`, `apiPrefix: '/api/v1'`, dan `useMockWhenOffline: false`. Buat helper pemilihan base di `forms.js` yang hanya memilih Worker ketika endpoint berawal `/mapaba/` dan Worker base terisi; tidak boleh diam-diam fallback ke mock.

- [ ] **Step 4: Tandai uploader MAPABA**

Tambahkan atribut Worker API ke dua uploader pada `src/pages/mapaba.html`. Ubah `uploader.js` agar memakai override hanya bila atribut itu ada. Pertahankan batas MIME/3 MB, progres XHR, pratinjau lokal, dan kontrak response `payload.data.url`.

- [ ] **Step 5: Tambahkan form token Worker dan client admin**

Tambahkan form token akses MAPABA pada `src/pages/admin-mapaba.html`. Pada `admin-mapaba.js`, simpan token ke `sessionStorage` setelah berhasil memuat daftar pertama; kirim `Authorization: Bearer` hanya ke Worker; tampilkan pesan eksplisit untuk 401/network failure. Arahkan kartu total/menunggu/diterima/kuota ke `/mapaba/admin/ringkasan` di Worker, bukan `/admin/ringkasan` Express atau gelombang publik Express. Tampilkan `sisaKuota: null` sebagai `—`. File berkas menggunakan `fetch` dengan token, membuat Blob URL, dan tidak pernah membuka URL Cloudinary.

Ubah `admin.js` logout untuk menghapus key `pmii_worker_admin_token` selain token/user Express. Jangan ubah URL API Express atau alur login lama.

- [ ] **Step 6: Jalankan tes frontend dan build**

Run: `node --test server/test/mapaba-worker-routing.test.js server/test/mapaba-form.test.js`
Expected: route MAPABA dan upload MAPABA menuju Worker, advokasi/upload generik tetap ke Express, logout menghapus token Worker, fallback palsu tetap mati.

Run: `npm run build`
Expected: proses HTML/Tailwind berhasil dan `public/admin/mapaba.html` mencerminkan sumber `src/pages/admin-mapaba.html`.

- [ ] **Step 7: Commit**

```powershell
git add public/assets/js/config.js public/assets/js/forms.js public/assets/js/uploader.js public/assets/js/admin-mapaba.js public/assets/js/admin.js src/pages/mapaba.html src/pages/admin-mapaba.html server/test/mapaba-form.test.js server/test/mapaba-worker-routing.test.js
git commit -m "feat(frontend): route MAPABA through Worker" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 8: Mendokumentasikan Setup dan Menjalankan Verifikasi Akhir

**Files:**
- Modify: `docs/BACKEND-SPEC.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `worker/.dev.vars.example`
- Verify: seluruh `worker/test/`, `server/test/`, dan hasil frontend build.

**Interfaces:**
- Consumes: konfigurasi final Worker, migration D1, secret names, API routes, dan frontend config dari Task 1–7.
- Produces: prosedur lokal/deploy yang membedakan D1 local/production serta menjelaskan token Worker dan provider HTTP.

- [ ] **Step 1: Tulis daftar periksa dokumentasi**

Pastikan panduan menyebut:

```text
Cloudflare D1 binding: DB
Secrets: ADMIN_TOKEN, RATE_LIMIT_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
         CLOUDINARY_API_SECRET, RESEND_API_KEY, CAPTCHA_SECRET_KEY, WA_API_TOKEN,
         GOOGLE_SHEETS_MAPABA_WEBHOOK_URL
Public vars: CORS_ORIGINS, CAPTCHA_PROVIDER, CAPTCHA_MIN_SCORE, CAPTCHA_FAIL_OPEN,
             MAPABA_NOTIFY_EMAIL, MAIL_FROM, WA_API_URL, SITE_URL
```

Jangan masukkan nilai secret atau D1 production ID contoh yang tampak dapat dipakai.

- [ ] **Step 2: Dokumentasikan pengembangan lokal**

Tambahkan urutan perintah: `npm install --prefix worker`, `npm --prefix worker run db:migrate:local`, `npm --prefix worker run db:seed:local`, `npm --prefix worker run dev`, serta cara mengisi `.dev.vars` dari template. Tegaskan `.dev.vars` tidak di-commit dan Cloudinary/Resend dapat dimock pada tes.

- [ ] **Step 3: Dokumentasikan setup Cloudflare tanpa deploy**

Jelaskan pembuatan D1, penggantian database ID di `wrangler.jsonc`, penerapan migration remote sebagai instruksi manual (tidak dijalankan), pengisian Cloudflare Secrets, daftar origin CORS yang benar, dan pembuatan gelombang produksi sebelum mengubah `mapabaApiBaseUrl`. Tegaskan data SQLite lama tidak diimpor otomatis.

- [ ] **Step 4: Dokumentasikan fase migrasi**

Perbarui `docs/BACKEND-SPEC.md` untuk membedakan endpoint yang masih di Express dengan endpoint MAPABA di Worker. Perbarui `docs/DEPLOYMENT.md` untuk deployment Express lama dan Worker terpisah; sebutkan tahap Advokasi/CMS sebagai pekerjaan berikutnya, bukan sebagai endpoint yang sudah tersedia.

- [ ] **Step 5: Jalankan seluruh tes Worker**

Run: `npm --prefix worker test`
Expected: semua tes D1, Worker route, Cloudinary mock, notification mock, concurrency, CORS, auth, serta error handling lulus.

- [ ] **Step 6: Jalankan regresi Express dan build statis**

Run: `npm test`
Expected: uji asap API Express lulus dengan flow Advokasi/MAPABA/admin lama yang belum dipindahkan.

Run: `npm run build`
Expected: output halaman statis sukses dan script `config.js` tetap mematikan mock offline.

Run: `git diff --check`
Expected: tidak ada whitespace error atau file secret terlacak.

- [ ] **Step 7: Pastikan secret dan perubahan produksi tidak ada**

Run: `git status --short; git ls-files worker/.dev.vars`
Expected: hanya source/doc/test yang direncanakan berubah; output `git ls-files` kosong untuk `worker/.dev.vars`. Jangan menjalankan `wrangler deploy`, remote D1 migration, atau mengubah API production URL.

- [ ] **Step 8: Commit**

```powershell
git add docs/BACKEND-SPEC.md docs/DEPLOYMENT.md worker/.dev.vars.example
git commit -m "docs(worker): document MAPABA Worker setup" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Rekomendasi Eksekusi

Gunakan **Native**: task-task ini berbagi interface Worker, skema D1, referensi upload, dan konfigurasi frontend yang harus dijaga konsisten. Implementasi berurutan dalam satu sesi mengurangi risiko perbedaan asumsi pada kontrak antar-task; setelah seluruh task selesai, lakukan satu review menyeluruh.
