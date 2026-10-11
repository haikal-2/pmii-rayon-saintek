/**
 * Halaman "Data Pendaftar MAPABA" pada panel admin.
 *
 * Tanggung jawab: memuat daftar pendaftar dengan penyaring & paginasi,
 * menampilkan berkas yang diunggah, serta menjalankan aksi Terima/Tolak.
 */
(function () {
  'use strict';

  const A = window.PMII_ADMIN;
  if (!A) return;

  const CONFIG = window.PMII_CONFIG || {};
  const WORKER_ORIGIN = CONFIG.mapabaApiBaseUrl || '';
  const WORKER_BASE = `${WORKER_ORIGIN}${CONFIG.apiPrefix || '/api/v1'}`;
  const WORKER_TOKEN_KEY = 'pmii_worker_admin_token';
  const q = (sel) => document.querySelector(sel);
  const tabel = q('[data-tabel]');
  if (!tabel) return;
  const workerForm = q('[data-worker-admin-form]');
  const workerTokenInput = q('[data-worker-admin-token]');
  const workerError = q('[data-worker-admin-error]');
  let workerToken = WORKER_ORIGIN ? sessionStorage.getItem(WORKER_TOKEN_KEY) || '' : '';

  const state = { status: '', q: '', page: 1, limit: 20, total: 0, totalPage: 1, baris: [] };

  async function workerApi(path, options = {}) {
    if (!WORKER_ORIGIN) return A.api(path, options);
    if (!workerToken) throw new Error('Masukkan token akses MAPABA Worker.');

    let response;
    try {
      response = await fetch(`${WORKER_BASE}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${workerToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('Tidak dapat menghubungi Worker MAPABA. Periksa URL Worker dan koneksi internet.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) clearWorkerToken();
      const error = new Error(
        payload.message ||
          (response.status === 401
            ? 'Token akses MAPABA Worker tidak valid.'
            : `Permintaan Worker gagal (HTTP ${response.status}).`)
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showWorkerError(message) {
    if (!workerError) return;
    workerError.textContent = message;
    workerError.hidden = !message;
    if (message && workerForm) workerForm.hidden = false;
  }

  function clearWorkerToken() {
    workerToken = '';
    sessionStorage.removeItem(WORKER_TOKEN_KEY);
    if (workerTokenInput) workerTokenInput.value = '';
  }

  const STATUS = {
    menunggu: ['Menunggu', 'bg-amber-50 text-amber-700 ring-amber-200'],
    terverifikasi: ['Diterima', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
    hadir: ['Hadir', 'bg-pmii-50 text-pmii-700 ring-pmii-200'],
    ditolak: ['Ditolak', 'bg-red-50 text-red-700 ring-red-200'],
    batal: ['Batal', 'bg-slate-100 text-slate-600 ring-slate-200'],
  };

  function pill(status) {
    const [label, warna] = STATUS[status] || STATUS.batal;
    return `<span class="pill ${warna}">${label}</span>`;
  }

  function tautanBerkas(url, label) {
    if (!url) {
      return `<span class="text-xs text-slate-400">${label}: —</span>`;
    }
    return `<button type="button" data-file-url="${A.escapeHtml(url)}"
              class="inline-flex items-center gap-1 text-xs font-semibold text-pmii-700 hover:underline">
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
              </svg>${label}</button>`;
  }

  function baris(item) {
    // Tombol aksi hanya relevan selama keputusan belum diambil; setelah itu
    // panitia masih bisa mengubah lewat tombol "Ubah status".
    const aksi =
      item.status === 'menunggu'
        ? `<button type="button" data-terima="${item.id}"
             class="btn bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700">Terima</button>
           <button type="button" data-tolak="${item.id}"
             class="btn border border-red-200 bg-white px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">Tolak</button>`
        : `<button type="button" data-ubah="${item.id}"
             class="btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Ubah status</button>`;

    return `
      <tr class="transition-colors hover:bg-slate-50/70">
        <td class="admin-td">
          <span class="font-mono text-xs font-semibold text-pmii-800">${A.escapeHtml(item.nomorRegistrasi)}</span>
          <p class="mt-1 text-xs text-slate-400">${A.tanggal(item.dibuatPada)}</p>
        </td>
        <td class="admin-td">
          <p class="font-semibold text-pmii-950">${A.escapeHtml(item.namaLengkap)}</p>
          <p class="mt-0.5 text-xs text-slate-500">NIM ${A.escapeHtml(item.nim)} · Angkatan ${item.angkatan}</p>
        </td>
        <td class="admin-td">
          <p>${A.escapeHtml(item.fakultas)}</p>
          <p class="mt-0.5 text-xs text-slate-500">${A.escapeHtml(item.prodi)}</p>
        </td>
        <td class="admin-td">
          <a href="https://wa.me/62${A.escapeHtml(String(item.whatsapp).replace(/^0|\D/g, ''))}"
             target="_blank" rel="noopener noreferrer"
             class="text-sm font-medium text-pmii-700 hover:underline">${A.escapeHtml(item.whatsapp)}</a>
          <p class="mt-0.5 truncate text-xs text-slate-500">${A.escapeHtml(item.email)}</p>
        </td>
        <td class="admin-td">
          <div class="flex flex-col gap-1">
            ${tautanBerkas(item.pasFotoUrl, 'Pas foto')}
            ${tautanBerkas(item.ktmUrl, 'KTM')}
          </div>
        </td>
        <td class="admin-td">
          ${pill(item.status)}
          ${item.catatanPanitia ? `<p class="mt-1.5 max-w-[14rem] text-xs italic text-slate-500">${A.escapeHtml(item.catatanPanitia)}</p>` : ''}
        </td>
        <td class="admin-td text-right">
          <div class="inline-flex flex-wrap justify-end gap-2">${aksi}</div>
        </td>
      </tr>`;
  }

  function isLegacyMapabaFileUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.username || url.password) return false;

    const apiOrigin = new URL(
      CONFIG.apiBaseUrl || window.location.origin,
      window.location.origin
    ).origin;
    if (url.origin === apiOrigin && url.pathname.startsWith('/uploads/mapaba/')) return true;
    if (url.protocol !== 'https:' || !url.pathname.includes('/mapaba/')) return false;

    if (
      url.hostname === 'res.cloudinary.com' ||
      /(?:^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(url.hostname)
    ) {
      return true;
    }

    return Array.isArray(CONFIG.mapabaFileOrigins) &&
      CONFIG.mapabaFileOrigins.includes(url.origin);
  }

  async function muat() {
    tabel.innerHTML = '<tr><td class="admin-td text-slate-500" colspan="7">Memuat data pendaftar…</td></tr>';
    if (WORKER_ORIGIN && !workerToken) {
      tabel.innerHTML = '<tr><td class="admin-td text-slate-500" colspan="7">Masukkan token Worker untuk memuat data.</td></tr>';
      return false;
    }

    const params = new URLSearchParams({ page: state.page, limit: state.limit });
    if (state.status) params.set('status', state.status);
    if (state.q) params.set('q', state.q);

    try {
      const { data, meta } = await workerApi(`/mapaba/admin/pendaftar?${params}`);
      state.baris = data;
      state.total = meta.total;
      state.totalPage = meta.totalPage || 1;

      tabel.innerHTML = data.length
        ? data.map(baris).join('')
        : '<tr><td class="admin-td text-center text-slate-500" colspan="7">Tidak ada pendaftar yang cocok dengan penyaring ini.</td></tr>';

      const awal = (state.page - 1) * state.limit + 1;
      const akhir = Math.min(state.page * state.limit, state.total);
      q('[data-info-halaman]').textContent = state.total
        ? `Menampilkan ${awal}–${akhir} dari ${state.total} pendaftar`
        : 'Tidak ada data';

      q('[data-hal-sebelumnya]').disabled = state.page <= 1;
      q('[data-hal-berikutnya]').disabled = state.page >= state.totalPage;
      return true;
    } catch (error) {
      if (error.status === 401) clearWorkerToken();
      if (WORKER_ORIGIN) showWorkerError(error.message);
      tabel.innerHTML = `<tr><td class="admin-td text-red-600" colspan="7">${A.escapeHtml(error.message)}</td></tr>`;
      return false;
    }
  }

  async function muatRingkasan() {
    try {
      const { data } = await workerApi(
        WORKER_ORIGIN ? '/mapaba/admin/ringkasan' : '/admin/ringkasan'
      );
      const ringkasan = WORKER_ORIGIN ? data : data.mapaba;
      q('[data-stat-total]').textContent = ringkasan.total ?? 0;
      q('[data-stat-menunggu]').textContent = ringkasan.menunggu ?? 0;
      q('[data-stat-diterima]').textContent = ringkasan.terverifikasi ?? 0;
      const sisaKuota = WORKER_ORIGIN
        ? ringkasan.sisaKuota
        : (await A.api('/mapaba/gelombang-aktif')).data.sisaKuota;
      q('[data-stat-kuota]').textContent = sisaKuota ?? '—';
    } catch (error) {
      if (error.status === 401) clearWorkerToken();
      if (WORKER_ORIGIN) showWorkerError(error.message);
      else A.toast(error.message, 'galat');
    }
  }

  async function hubungkanWorker(event) {
    event.preventDefault();
    if (!WORKER_ORIGIN) return;
    workerToken = workerTokenInput?.value.trim() || '';
    showWorkerError('');
    if (!workerToken) {
      showWorkerError('Masukkan token akses MAPABA Worker.');
      return;
    }

    if (!(await muat())) {
      workerToken = '';
      return;
    }
    sessionStorage.setItem(WORKER_TOKEN_KEY, workerToken);
    if (workerForm) workerForm.hidden = true;
    await muatRingkasan();
  }

  async function ubahStatus(id, status) {
    const teks = {
      terverifikasi: {
        judul: 'Terima pendaftar ini?',
        pesan:
          'Pendaftar akan ditandai terverifikasi dan sistem mengirimkan pemberitahuan penerimaan melalui email serta WhatsApp.',
        label: 'Ya, Terima',
        gaya: 'btn-primary',
      },
      ditolak: {
        judul: 'Tolak pendaftar ini?',
        pesan:
          'Pendaftar akan diberi tahu bahwa pendaftarannya belum dapat diterima. Sebaiknya isi catatan agar alasannya jelas.',
        label: 'Ya, Tolak',
        gaya: 'btn bg-red-600 text-white hover:bg-red-700',
      },
      menunggu: {
        judul: 'Kembalikan ke status menunggu?',
        pesan: 'Status pendaftar dikembalikan menjadi menunggu verifikasi.',
        label: 'Ya, Kembalikan',
        gaya: 'btn-primary',
      },
    }[status];

    const hasil = await A.konfirmasi({
      judul: teks.judul,
      pesan: teks.pesan,
      labelKonfirmasi: teks.label,
      gaya: teks.gaya,
    });
    if (!hasil) return;

    try {
      await workerApi(`/mapaba/admin/pendaftar/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, catatanPanitia: hasil.catatan || undefined }),
      });
      A.toast(status === 'ditolak' ? 'Pendaftar ditolak.' : 'Status pendaftar diperbarui.');
      if (await muat()) await muatRingkasan();
    } catch (error) {
      A.toast(error.message, 'galat');
    }
  }

  /** Ekspor seluruh hasil penyaring saat ini (bukan hanya halaman aktif). */
  async function eksporCsv() {
    try {
      const params = new URLSearchParams({ page: 1, limit: 200 });
      if (state.status) params.set('status', state.status);
      if (state.q) params.set('q', state.q);

      const { data } = await workerApi(`/mapaba/admin/pendaftar?${params}`);
      A.unduhCsv(`pendaftar-mapaba-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['No. Registrasi', 'Nama', 'NIM', 'Angkatan', 'Universitas', 'Fakultas', 'Prodi', 'JK', 'WhatsApp', 'Email', 'Status', 'Tanggal Daftar'],
        ...data.map((item) => [
          item.nomorRegistrasi,
          item.namaLengkap,
          item.nim,
          item.angkatan,
          item.universitas,
          item.fakultas,
          item.prodi,
          item.jenisKelamin,
          item.whatsapp,
          item.email,
          item.status,
          item.dibuatPada,
        ]),
      ]);
      A.toast(`${data.length} baris diekspor.`);
    } catch (error) {
      A.toast(error.message, 'galat');
    }
  }

  async function bukaBerkas(path) {
    if (!WORKER_ORIGIN) {
      if (!isLegacyMapabaFileUrl(path)) {
        A.toast('Referensi berkas tidak valid.', 'galat');
        return;
      }
      const tab = window.open('about:blank', '_blank');
      if (!tab) {
        A.toast('Izinkan tab baru untuk membuka berkas.', 'galat');
        return;
      }
      tab.opener = null;
      tab.location.href = path;
      return;
    }

    if (!/^\/api\/v1\/mapaba\/admin\/files\/[A-Fa-f0-9-]{36}$/.test(path)) {
      A.toast('Referensi berkas tidak valid.', 'galat');
      return;
    }
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      A.toast('Izinkan tab baru untuk membuka berkas.', 'galat');
      return;
    }

    try {
      let response;
      try {
        response = await fetch(`${WORKER_ORIGIN}${path}`, {
          headers: { Authorization: `Bearer ${workerToken}` },
        });
      } catch {
        throw new Error('Tidak dapat menghubungi Worker MAPABA. Periksa URL Worker dan koneksi internet.');
      }
      if (!response.ok) {
        if (response.status === 401) {
          clearWorkerToken();
          showWorkerError('Token akses MAPABA Worker tidak valid.');
        }
        throw new Error(
          response.status === 401
            ? 'Token akses MAPABA Worker tidak valid.'
            : `Berkas tidak dapat dibuka (HTTP ${response.status}).`
        );
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      tab.opener = null;
      tab.location.href = objectUrl;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      tab.close();
      A.toast(error.message || 'Tidak dapat membuka berkas MAPABA.', 'galat');
    }
  }

  function pasangPeristiwa() {
    tabel.addEventListener('click', (event) => {
      const file = event.target.closest('[data-file-url]');
      const terima = event.target.closest('[data-terima]');
      const tolak = event.target.closest('[data-tolak]');
      const ubah = event.target.closest('[data-ubah]');
      if (file) bukaBerkas(file.dataset.fileUrl);
      if (terima) ubahStatus(terima.dataset.terima, 'terverifikasi');
      if (tolak) ubahStatus(tolak.dataset.tolak, 'ditolak');
      if (ubah) ubahStatus(ubah.dataset.ubah, 'menunggu');
    });

    document.querySelectorAll('[data-filter]').forEach((tombol) => {
      tombol.addEventListener('click', () => {
        document.querySelectorAll('[data-filter]').forEach((lain) => {
          lain.className = 'btn-outline btn-sm';
          lain.setAttribute('aria-pressed', 'false');
        });
        tombol.className = 'btn-primary btn-sm';
        tombol.setAttribute('aria-pressed', 'true');

        state.status = tombol.dataset.filter;
        state.page = 1;
        muat();
      });
    });

    // Tunda pencarian agar tidak memanggil API pada setiap ketukan tombol.
    let jeda;
    q('[data-cari]')?.addEventListener('input', (event) => {
      clearTimeout(jeda);
      jeda = setTimeout(() => {
        state.q = event.target.value.trim();
        state.page = 1;
        muat();
      }, 350);
    });

    q('[data-hal-sebelumnya]')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        muat();
      }
    });
    q('[data-hal-berikutnya]')?.addEventListener('click', () => {
      if (state.page < state.totalPage) {
        state.page += 1;
        muat();
      }
    });

    q('[data-ekspor-csv]')?.addEventListener('click', eksporCsv);
    workerForm?.addEventListener('submit', hubungkanWorker);
  }

  pasangPeristiwa();
  if (WORKER_ORIGIN && workerToken) {
    if (workerForm) workerForm.hidden = true;
    muat().then((loaded) => {
      if (loaded) muatRingkasan();
    });
  } else if (!WORKER_ORIGIN) {
    if (workerForm) workerForm.hidden = true;
    muat().then((loaded) => {
      if (loaded) muatRingkasan();
    });
  } else {
    muat();
  }
})();
