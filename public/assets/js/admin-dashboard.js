/**
 * Halaman ringkasan panel admin.
 * Mengisi kartu angka dan dua daftar "terbaru" dari tiga endpoint.
 */
(function () {
  'use strict';

  const A = window.PMII_ADMIN;
  if (!A || !document.querySelector('[data-pengaduan-terbaru]')) return;

  /** Ambil nilai bersarang, mis. "pengaduan.baru" dari objek ringkasan. */
  const ambil = (objek, jalur) =>
    jalur.split('.').reduce((acc, kunci) => (acc == null ? acc : acc[kunci]), objek);

  const KATEGORI = {
    akademik: 'Akademik',
    fasilitas: 'Fasilitas Kampus',
    kekerasan_seksual: 'Kekerasan / Pelecehan',
    ukt: 'UKT',
    perundungan: 'Perundungan',
    kebebasan_berpendapat: 'Kebebasan Berpendapat',
    ketenagakerjaan: 'Ketenagakerjaan',
    lainnya: 'Lainnya',
  };

  async function isiRingkasan() {
    try {
      const { data } = await A.api('/admin/ringkasan');
      document.querySelectorAll('[data-ringkas]').forEach((el) => {
        const nilai = ambil(data, el.dataset.ringkas);
        el.textContent = nilai ?? 0;
      });
    } catch (error) {
      A.toast(error.message, 'galat');
    }
  }

  async function isiPengaduan() {
    const wadah = document.querySelector('[data-pengaduan-terbaru]');
    try {
      const { data } = await A.api('/advokasi/admin/pengaduan?limit=5');
      wadah.innerHTML = data.length
        ? data
            .map(
              (item) => `
          <li class="flex items-start gap-3 px-5 py-4">
            <span class="mt-1 h-2 w-2 shrink-0 rounded-full ${
              item.prioritas === 'tinggi' || item.prioritas === 'darurat' ? 'bg-red-500' : 'bg-slate-300'
            }"></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-pmii-950">
                ${A.escapeHtml(item.isAnonim ? 'Pelapor anonim' : item.nama)}
                <span class="ml-1 font-mono text-xs font-normal text-slate-400">${A.escapeHtml(item.nomorTiket)}</span>
              </p>
              <p class="mt-0.5 text-xs text-slate-500">
                ${A.escapeHtml(KATEGORI[item.kategori] || item.kategori)} · ${A.tanggal(item.dibuatPada, true)}
              </p>
            </div>
            <span class="pill bg-slate-100 text-slate-600 ring-slate-200">${A.escapeHtml(item.status)}</span>
          </li>`
            )
            .join('')
        : '<li class="px-5 py-4 text-sm text-slate-500">Belum ada pengaduan masuk.</li>';
    } catch (error) {
      wadah.innerHTML = `<li class="px-5 py-4 text-sm text-red-600">${A.escapeHtml(error.message)}</li>`;
    }
  }

  async function isiPendaftar() {
    const wadah = document.querySelector('[data-pendaftar-terbaru]');
    try {
      const { data } = await A.api('/mapaba/admin/pendaftar?limit=5');
      wadah.innerHTML = data.length
        ? data
            .map(
              (item) => `
          <li class="flex items-center gap-3 px-5 py-4">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pmii-50 font-display text-sm font-bold text-pmii-700">
              ${A.escapeHtml(item.namaLengkap.charAt(0).toUpperCase())}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-pmii-950">${A.escapeHtml(item.namaLengkap)}</p>
              <p class="mt-0.5 truncate text-xs text-slate-500">${A.escapeHtml(item.fakultas)} · ${A.tanggal(item.dibuatPada)}</p>
            </div>
            <span class="pill ${
              item.status === 'terverifikasi'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : item.status === 'ditolak'
                  ? 'bg-red-50 text-red-700 ring-red-200'
                  : 'bg-amber-50 text-amber-700 ring-amber-200'
            }">${A.escapeHtml(item.status)}</span>
          </li>`
            )
            .join('')
        : '<li class="px-5 py-4 text-sm text-slate-500">Belum ada pendaftar.</li>';
    } catch (error) {
      wadah.innerHTML = `<li class="px-5 py-4 text-sm text-red-600">${A.escapeHtml(error.message)}</li>`;
    }
  }

  isiRingkasan();
  isiPengaduan();
  isiPendaftar();
})();
