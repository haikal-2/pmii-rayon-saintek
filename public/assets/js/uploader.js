/**
 * Pengunggah berkas dengan pratinjau dan indikator progres.
 *
 * Markup yang diharapkan:
 *   <div data-uploader data-uploader-target="pasFotoUrl" data-uploader-ratio="3/4">
 *     <label data-uploader-dropzone …>…</label>
 *     <input type="file" data-uploader-input />
 *     <div data-uploader-preview></div>
 *   </div>
 *   <input type="hidden" name="pasFotoUrl" />
 *
 * Berkas diunggah ke POST {apiBaseUrl}{apiPrefix}/upload segera setelah dipilih,
 * lalu URL hasilnya ditaruh di input tersembunyi. Mengunggah lebih awal (bukan
 * saat submit) membuat pengiriman formulir tetap cepat dan pengguna langsung
 * tahu bila berkasnya ditolak.
 *
 * XMLHttpRequest dipakai — bukan fetch — karena hanya XHR yang menyediakan
 * event progres unggah.
 */
(function () {
  'use strict';

  const CONFIG = window.PMII_CONFIG || {};
  const ENDPOINT = `${CONFIG.apiBaseUrl || ''}${CONFIG.apiPrefix || '/api/v1'}/upload`;

  const MAKS_BYTE = 3 * 1024 * 1024;
  const TIPE_DIIZINKAN = ['image/jpeg', 'image/png', 'image/webp'];

  const formatUkuran = (byte) =>
    byte >= 1024 * 1024 ? `${(byte / 1024 / 1024).toFixed(1)} MB` : `${Math.round(byte / 1024)} KB`;

  function setGalat(wadah, pesan) {
    const target = document.querySelector(`[data-error-for="${wadah.dataset.uploaderTarget}"]`);
    if (!target) return;
    target.textContent = pesan || '';
    target.classList.toggle('hidden', !pesan);
  }

  function render(wadah, { state, namaBerkas, ukuran, dataUrl, persen }) {
    const pratinjau = wadah.querySelector('[data-uploader-preview]');
    const dropzone = wadah.querySelector('[data-uploader-dropzone]');
    if (!pratinjau) return;

    pratinjau.classList.remove('hidden');
    dropzone?.classList.toggle('hidden', state !== 'kosong');

    if (state === 'mengunggah') {
      pratinjau.innerHTML = `
        <div class="rounded-xl border border-slate-200 bg-white p-4">
          <p class="truncate text-sm font-semibold text-pmii-950">${namaBerkas}</p>
          <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-pmii-600 transition-all duration-200" style="width:${persen}%"></div>
          </div>
          <p class="mt-2 text-xs text-slate-500">Mengunggah… ${persen}%</p>
        </div>`;
      return;
    }

    if (state === 'selesai') {
      const rasio = wadah.dataset.uploaderRatio || '3/4';
      pratinjau.innerHTML = `
        <div class="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <img src="${dataUrl}" alt="Pratinjau ${namaBerkas}"
               class="w-20 shrink-0 rounded-lg border border-emerald-200 object-cover"
               style="aspect-ratio:${rasio}" />
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
              <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Berhasil diunggah
            </p>
            <p class="mt-0.5 truncate text-xs text-emerald-800/80">${namaBerkas} · ${ukuran}</p>
            <button type="button" data-uploader-hapus
                    class="mt-2 text-xs font-semibold text-red-600 underline-offset-2 hover:underline">
              Ganti berkas
            </button>
          </div>
        </div>`;
      return;
    }

    pratinjau.classList.add('hidden');
    pratinjau.innerHTML = '';
  }

  function unggah(wadah, file) {
    const hidden = document.querySelector(`input[name="${wadah.dataset.uploaderTarget}"]`);
    const pembaca = new FileReader();
    pembaca.onload = () => (wadah.dataset.uploaderDataUrl = pembaca.result);
    pembaca.readAsDataURL(file);

    render(wadah, { state: 'mengunggah', namaBerkas: file.name, persen: 0 });

    const data = new FormData();
    data.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', ENDPOINT);

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      render(wadah, {
        state: 'mengunggah',
        namaBerkas: file.name,
        persen: Math.round((event.loaded / event.total) * 100),
      });
    });

    xhr.addEventListener('load', () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = {};
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload.data?.url) {
        if (hidden) hidden.value = payload.data.url;
        render(wadah, {
          state: 'selesai',
          namaBerkas: file.name,
          ukuran: formatUkuran(file.size),
          dataUrl: wadah.dataset.uploaderDataUrl || '',
        });
        return;
      }

      render(wadah, { state: 'kosong' });
      setGalat(
        wadah,
        payload.errors?.file || payload.message || 'Unggahan gagal. Periksa koneksi lalu coba lagi.'
      );
    });

    xhr.addEventListener('error', () => {
      render(wadah, { state: 'kosong' });
      setGalat(wadah, 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.');
    });

    xhr.send(data);
  }

  function pilih(wadah, file) {
    setGalat(wadah, '');
    if (!file) return;

    // Validasi di klien lebih dulu supaya pengguna tidak menunggu unggahan yang
    // sudah pasti ditolak server (server tetap memvalidasi ulang).
    if (!TIPE_DIIZINKAN.includes(file.type)) {
      setGalat(wadah, 'Format harus JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > MAKS_BYTE) {
      setGalat(wadah, `Ukuran berkas ${formatUkuran(file.size)} melebihi batas 3 MB.`);
      return;
    }

    unggah(wadah, file);
  }

  function init() {
    document.querySelectorAll('[data-uploader]').forEach((wadah) => {
      const input = wadah.querySelector('[data-uploader-input]');
      const dropzone = wadah.querySelector('[data-uploader-dropzone]');
      if (!input) return;

      input.addEventListener('change', () => pilih(wadah, input.files[0]));

      // Dukungan seret-dan-lepas pada area unggah.
      ['dragenter', 'dragover'].forEach((jenis) =>
        dropzone?.addEventListener(jenis, (event) => {
          event.preventDefault();
          dropzone.classList.add('border-pmii-500', 'bg-pmii-50');
        })
      );
      ['dragleave', 'drop'].forEach((jenis) =>
        dropzone?.addEventListener(jenis, (event) => {
          event.preventDefault();
          dropzone.classList.remove('border-pmii-500', 'bg-pmii-50');
        })
      );
      dropzone?.addEventListener('drop', (event) => pilih(wadah, event.dataTransfer?.files?.[0]));

      wadah.addEventListener('click', (event) => {
        if (!event.target.closest('[data-uploader-hapus]')) return;
        const hidden = document.querySelector(`input[name="${wadah.dataset.uploaderTarget}"]`);
        if (hidden) hidden.value = '';
        input.value = '';
        render(wadah, { state: 'kosong' });
      });
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
