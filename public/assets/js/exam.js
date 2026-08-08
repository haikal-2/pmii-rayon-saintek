/**
 * Ruang ujian CBT BIMTES.
 *
 * Bergantung pada cbt.js untuk `window.PMII_CBT.cbtFetch()` (Bearer token +
 * penanganan 401). Berkas ini mengurus: pemuatan sesi, navigasi soal, autosave,
 * penanda ragu-ragu, penghitung waktu, dan pengumpulan.
 *
 * Tiga keputusan yang menentukan perilaku halaman ini:
 *
 * 1. **Waktu milik server.** Timer di layar hanya menghitung mundur dari
 *    `sisaDetik` yang diberikan API, dan diselaraskan ulang setiap kali autosave
 *    berhasil serta ketika tab kembali aktif. Mengubah jam perangkat tidak
 *    menambah waktu ujian.
 * 2. **Autosave per soal.** Setiap pilihan langsung dikirim ke server
 *    (UPSERT idempoten), jadi listrik padam atau peramban tertutup tidak
 *    menghilangkan jawaban. Tidak ada tombol "simpan".
 * 3. **Optimistic UI.** Tampilan diperbarui lebih dulu, pengiriman menyusul.
 *    Bila pengiriman gagal, jawaban dimasukkan ke antrean dan dicoba lagi.
 */
(function () {
  'use strict';

  const CBT = window.PMII_CBT;
  if (!CBT) return;

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    status: q('[data-status]'),
    ruang: q('[data-ruang]'),
    paketNama: q('[data-paket-nama]'),
    navigasi: q('[data-navigasi]'),
    nomorSoal: q('[data-nomor-soal]'),
    subtes: q('[data-subtes]'),
    posisi: q('[data-posisi]'),
    total: q('[data-total]'),
    pertanyaan: q('[data-pertanyaan]'),
    gambar: q('[data-gambar-soal]'),
    opsi: q('[data-opsi]'),
    ragu: q('[data-ragu]'),
    timerTeks: q('[data-timer-teks]'),
    timer: q('[data-timer]'),
    timerIcon: q('[data-timer-icon]'),
    progress: q('[data-progress]'),
    autosave: q('[data-autosave]'),
    dialog: q('[data-dialog-submit]'),
    layarHasil: q('[data-layar-hasil]'),
  };

  const state = {
    sesiId: null,
    soal: [],
    indeks: 0,
    sisaDetik: 0,
    selesai: false,
    antrean: new Map(), // soalId → payload yang belum berhasil terkirim
  };

  /* --------------------------------------------------------------- Utilitas */

  const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);

  function pesanGalat(judul, detail) {
    if (!el.status) return;
    el.status.hidden = false;
    el.ruang.hidden = true;
    el.status.innerHTML = `
      <span class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600">
        <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"/></svg>
      </span>
      <h1 class="mt-4 text-xl">${escapeHtml(judul)}</h1>
      <p class="mt-2 text-sm text-slate-600">${escapeHtml(detail)}</p>
      <a href="dashboard.html" class="btn-primary mt-6">Kembali ke Dashboard</a>`;
  }

  const statusSoal = (soal) => {
    if (soal.jawaban?.ragu) return 'ragu';
    return soal.jawaban?.opsiId ? 'terjawab' : 'kosong';
  };

  /* ------------------------------------------------------------- Penghitung */

  function formatWaktu(detik) {
    const jam = Math.floor(detik / 3600);
    const menit = Math.floor((detik % 3600) / 60);
    const sisa = detik % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(jam)}:${pad(menit)}:${pad(sisa)}`;
  }

  function gambarTimer() {
    if (!el.timerTeks) return;
    el.timerTeks.textContent = formatWaktu(Math.max(0, state.sisaDetik));

    // Peringatan visual di lima menit terakhir.
    const mendesak = state.sisaDetik <= 300;
    el.timer.classList.toggle('border-red-300', mendesak);
    el.timer.classList.toggle('bg-red-50', mendesak);
    el.timer.classList.toggle('border-pmii-200', !mendesak);
    el.timer.classList.toggle('bg-pmii-50', !mendesak);
    el.timerTeks.classList.toggle('text-red-600', mendesak);
    el.timerTeks.classList.toggle('text-pmii-900', !mendesak);
    el.timerIcon?.classList.toggle('text-red-600', mendesak);
    el.timerIcon?.classList.toggle('animate-pulse', state.sisaDetik <= 60);
  }

  function mulaiTimer() {
    gambarTimer();
    setInterval(() => {
      if (state.selesai) return;
      state.sisaDetik -= 1;
      gambarTimer();

      if (state.sisaDetik <= 0) {
        // Waktu habis: server sudah menutup sesi otomatis, klien menyusul.
        kumpulkan(true);
      }
    }, 1000);
  }

  /* --------------------------------------------------------------- Render */

  /** Menggambar ulang peta nomor soal dan mengembalikan rekap statusnya. */
  function gambarNavigasi() {
    const terjawab = state.soal.filter((s) => statusSoal(s) === 'terjawab').length;
    const ragu = state.soal.filter((s) => statusSoal(s) === 'ragu').length;
    const rekap = { terjawab, ragu, kosong: state.soal.length - terjawab - ragu };

    if (!el.navigasi) return rekap;

    el.navigasi.innerHTML = state.soal
      .map((soal, i) => {
        const status = statusSoal(soal);
        const aktif = i === state.indeks;
        const warna =
          status === 'terjawab'
            ? 'border-pmii-700 bg-pmii-700 text-white'
            : status === 'ragu'
              ? 'border-kuning-500 bg-kuning-400 text-pmii-950'
              : 'border-slate-300 bg-white text-slate-600 hover:border-pmii-400';
        const cincin = aktif ? 'ring-2 ring-offset-2 ring-pmii-500' : '';
        return `<button type="button" data-ke-soal="${i}" aria-current="${aktif}"
                  class="h-10 rounded-lg border text-sm font-bold transition-all ${warna} ${cincin}">${i + 1}</button>`;
      })
      .join('');

    q('[data-hitung-terjawab]').textContent = rekap.terjawab;
    q('[data-hitung-ragu]').textContent = rekap.ragu;
    q('[data-hitung-kosong]').textContent = rekap.kosong;

    if (el.progress) {
      el.progress.style.width = `${Math.round(((rekap.terjawab + rekap.ragu) / state.soal.length) * 100)}%`;
    }
    return rekap;
  }

  function gambarSoal() {
    const soal = state.soal[state.indeks];
    if (!soal) return;

    el.nomorSoal.textContent = state.indeks + 1;
    el.posisi.textContent = state.indeks + 1;
    el.total.textContent = state.soal.length;
    el.subtes.textContent = soal.subtes || 'Soal';
    el.pertanyaan.innerHTML = `<p>${escapeHtml(soal.pertanyaan).replace(/\n/g, '<br>')}</p>`;

    if (soal.gambarUrl) {
      el.gambar.src = soal.gambarUrl;
      el.gambar.hidden = false;
    } else {
      el.gambar.hidden = true;
      el.gambar.removeAttribute('src');
    }

    const dipilih = soal.jawaban?.opsiId;
    el.opsi.innerHTML = soal.opsi
      .map((opsi, i) => {
        const aktif = dipilih === opsi.id;
        // Label ditentukan dari posisi tampil, bukan dari basis data, karena
        // urutan opsi diacak per peserta.
        const huruf = String.fromCharCode(65 + i);
        return `
          <button type="button" data-pilih-opsi="${opsi.id}" role="radio" aria-checked="${aktif}"
            class="flex w-full items-start gap-4 rounded-xl border-2 px-4 py-3.5 text-left transition-all ${
              aktif
                ? 'border-pmii-600 bg-pmii-50 shadow-card'
                : 'border-slate-200 bg-white hover:border-pmii-300 hover:bg-slate-50'
            }">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 font-display text-sm font-bold ${
              aktif ? 'border-pmii-600 bg-pmii-600 text-white' : 'border-slate-300 text-slate-500'
            }">${huruf}</span>
            <span class="flex-1 pt-1 text-sm leading-relaxed text-slate-800">${escapeHtml(opsi.teks)}</span>
          </button>`;
      })
      .join('');

    const ragu = Boolean(soal.jawaban?.ragu);
    el.ragu.setAttribute('aria-pressed', String(ragu));
    el.ragu.classList.toggle('border-kuning-500', ragu);
    el.ragu.classList.toggle('bg-kuning-400', ragu);
    el.ragu.classList.toggle('text-pmii-950', ragu);

    q('[data-sebelumnya]').disabled = state.indeks === 0;
    q('[data-selanjutnya]').disabled = state.indeks === state.soal.length - 1;

    gambarNavigasi();
  }

  /* -------------------------------------------------------------- Autosave */

  function tandaiAutosave(kondisi) {
    if (!el.autosave) return;
    const gaya = {
      tersimpan: ['bg-emerald-500', 'Jawaban tersimpan otomatis'],
      menyimpan: ['bg-amber-400', 'Menyimpan…'],
      gagal: ['bg-red-500', 'Gagal menyimpan — akan dicoba lagi'],
    }[kondisi];
    el.autosave.innerHTML = `<span class="h-1.5 w-1.5 rounded-full ${gaya[0]}"></span> ${gaya[1]}`;
  }

  async function simpanJawaban(soal) {
    const payload = {
      soalId: soal.id,
      opsiId: soal.jawaban?.opsiId ?? null,
      ragu: Boolean(soal.jawaban?.ragu),
    };

    tandaiAutosave('menyimpan');
    try {
      const hasil = await CBT.cbtFetch(`/cbt/sesi/${state.sesiId}/jawaban`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      state.antrean.delete(soal.id);
      tandaiAutosave('tersimpan');

      // Selaraskan timer dengan sisa waktu versi server.
      if (typeof hasil?.data?.sisaDetik === 'number') {
        state.sisaDetik = hasil.data.sisaDetik;
        gambarTimer();
      }
    } catch (error) {
      console.warn('[exam] gagal menyimpan jawaban:', error.message);
      state.antrean.set(soal.id, payload);
      tandaiAutosave('gagal');
    }
  }

  /** Coba kirim ulang jawaban yang sempat gagal (mis. koneksi terputus). */
  async function prosesAntrean() {
    if (!state.antrean.size || state.selesai) return;
    for (const soalId of Array.from(state.antrean.keys())) {
      const soal = state.soal.find((item) => item.id === soalId);
      if (soal) await simpanJawaban(soal);
    }
  }

  /* ----------------------------------------------------------------- Aksi */

  function keSoal(indeks) {
    state.indeks = Math.max(0, Math.min(state.soal.length - 1, indeks));
    gambarSoal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function pilihOpsi(opsiId) {
    const soal = state.soal[state.indeks];
    soal.jawaban = { ...(soal.jawaban || {}), opsiId };
    gambarSoal();
    simpanJawaban(soal);
  }

  function hapusJawaban() {
    const soal = state.soal[state.indeks];
    soal.jawaban = { ...(soal.jawaban || {}), opsiId: null };
    gambarSoal();
    simpanJawaban(soal);
  }

  function toggleRagu() {
    const soal = state.soal[state.indeks];
    soal.jawaban = { ...(soal.jawaban || {}), ragu: !soal.jawaban?.ragu };
    gambarSoal();
    simpanJawaban(soal);
  }

  function bukaDialog() {
    const { terjawab, ragu, kosong } = gambarNavigasi();
    q('[data-ringkas-terjawab]').textContent = terjawab;
    q('[data-ringkas-ragu]').textContent = ragu;
    q('[data-ringkas-kosong]').textContent = kosong;

    const peringatan = q('[data-peringatan-kosong]');
    const belum = kosong + ragu;
    if (belum > 0) {
      peringatan.hidden = false;
      peringatan.textContent = `Masih ada ${belum} soal yang belum dijawab atau ditandai ragu-ragu. Soal kosong dihitung salah.`;
    } else {
      peringatan.hidden = true;
    }

    el.dialog.hidden = false;
  }

  async function kumpulkan(otomatis = false) {
    if (state.selesai) return;
    state.selesai = true;
    el.dialog.hidden = true;

    // Pastikan jawaban yang tertahan di antrean terkirim sebelum dinilai.
    await prosesAntrean();

    try {
      const hasil = await CBT.cbtFetch(`/cbt/sesi/${state.sesiId}/submit`, { method: 'POST' });
      const data = hasil?.data || {};

      q('[data-hasil-skor]').textContent = data.skor ?? '—';
      q('[data-hasil-benar]').textContent = data.benar ?? 0;
      q('[data-hasil-salah]').textContent = data.salah ?? 0;
      q('[data-hasil-kosong]').textContent = data.kosong ?? 0;
      q('[data-hasil-pesan]').textContent = otomatis
        ? 'Waktu habis. Jawaban terakhir kamu sudah tersimpan dan dinilai otomatis.'
        : 'Jawaban kamu sudah tersimpan dan dinilai.';

      el.layarHasil.hidden = false;
    } catch (error) {
      state.selesai = false;
      alert(`Gagal mengumpulkan jawaban: ${error.message}\nPeriksa koneksi lalu coba lagi.`);
    }
  }

  /* ------------------------------------------------------------- Pemuatan */

  async function muat() {
    const sesiId = new URLSearchParams(window.location.search).get('sesi');
    if (!sesiId) {
      pesanGalat('Sesi ujian tidak ditemukan', 'Mulai ujian dari halaman dashboard terlebih dahulu.');
      return;
    }
    state.sesiId = sesiId;

    let hasil;
    try {
      hasil = await CBT.cbtFetch(`/cbt/sesi/${sesiId}`);
    } catch (error) {
      pesanGalat('Tidak dapat memuat soal', error.message);
      return;
    }

    if (!hasil?.ok) {
      pesanGalat('Tidak dapat memuat soal', hasil?.message || 'Sesi tidak tersedia.');
      return;
    }

    const { sesi, paket, soal } = hasil.data;

    if (sesi.status !== 'berjalan') {
      pesanGalat(
        'Sesi ini sudah berakhir',
        'Ujian sudah dikumpulkan atau waktunya habis. Lihat hasilnya di dashboard.'
      );
      return;
    }

    state.soal = soal;
    state.sisaDetik = sesi.sisaDetik;
    el.paketNama.textContent = paket.nama;

    el.status.hidden = true;
    el.ruang.hidden = false;

    gambarSoal();
    mulaiTimer();
  }

  /* -------------------------------------------------------------- Peristiwa */

  function pasangPeristiwa() {
    el.navigasi?.addEventListener('click', (event) => {
      const tombol = event.target.closest('[data-ke-soal]');
      if (tombol) keSoal(Number(tombol.dataset.keSoal));
    });

    el.opsi?.addEventListener('click', (event) => {
      const tombol = event.target.closest('[data-pilih-opsi]');
      if (tombol) pilihOpsi(Number(tombol.dataset.pilihOpsi));
    });

    q('[data-sebelumnya]')?.addEventListener('click', () => keSoal(state.indeks - 1));
    q('[data-selanjutnya]')?.addEventListener('click', () => keSoal(state.indeks + 1));
    q('[data-hapus-jawaban]')?.addEventListener('click', hapusJawaban);
    el.ragu?.addEventListener('click', toggleRagu);

    qa('[data-buka-submit]').forEach((b) => b.addEventListener('click', bukaDialog));
    q('[data-tutup-dialog]')?.addEventListener('click', () => (el.dialog.hidden = true));
    q('[data-konfirmasi-submit]')?.addEventListener('click', () => kumpulkan(false));

    q('[data-toggle-navigasi]')?.addEventListener('click', (event) => {
      const tersembunyi = el.navigasi.classList.toggle('hidden');
      event.target.textContent = tersembunyi ? 'Tampilkan' : 'Sembunyikan';
    });

    // Pintasan papan tik: ← → pindah soal, A–E memilih jawaban.
    document.addEventListener('keydown', (event) => {
      if (state.selesai || !el.dialog.hidden) return;
      if (event.key === 'ArrowLeft') keSoal(state.indeks - 1);
      if (event.key === 'ArrowRight') keSoal(state.indeks + 1);

      const huruf = event.key.toUpperCase();
      if (/^[A-E]$/.test(huruf)) {
        const opsi = state.soal[state.indeks]?.opsi[huruf.charCodeAt(0) - 65];
        if (opsi) pilihOpsi(opsi.id);
      }
    });

    // Kembali online / tab aktif lagi: kirim antrean dan selaraskan waktu.
    window.addEventListener('online', prosesAntrean);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') prosesAntrean();
    });

    // Cegah peserta menutup tab tanpa sadar saat ujian masih berjalan.
    window.addEventListener('beforeunload', (event) => {
      if (state.selesai) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function init() {
    if (!el.ruang) return;
    pasangPeristiwa();
    muat();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
