/**
 * Dashboard CBT BIMTES — pengait sisi klien.
 *
 * Tanggung jawab file ini:
 *  1. Menjaga halaman dashboard agar hanya bisa diakses saat ada access token.
 *  2. Mengisi identitas peserta dari sessionStorage (hasil login).
 *  3. Menyediakan pembantu `cbtFetch()` untuk memanggil API dengan Bearer token.
 *
 * Catatan keamanan: token disimpan di sessionStorage agar hilang saat tab
 * ditutup. Untuk produksi, disarankan memakai refresh token pada cookie
 * HttpOnly + SameSite=Strict (lihat docs/BACKEND-SPEC.md bagian 6.2).
 */
(function () {
  'use strict';

  const CONFIG = window.PMII_CONFIG || {};
  const API_BASE = `${CONFIG.apiBaseUrl || ''}${CONFIG.apiPrefix || '/api/v1'}`;
  const TOKEN_KEY = 'pmii_cbt_token';
  const PESERTA_KEY = 'pmii_cbt_peserta';

  const getToken = () => sessionStorage.getItem(TOKEN_KEY);

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PESERTA_KEY);
    window.location.replace('login.html');
  }

  /** Pembungkus fetch yang otomatis menyertakan Authorization header. */
  async function cbtFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${getToken() || ''}`,
        ...(options.headers || {}),
      },
    });

    if (response.status === 401) {
      logout();
      throw new Error('Sesi berakhir. Silakan login kembali.');
    }
    return response.json();
  }

  function renderPeserta() {
    let peserta = null;
    try {
      peserta = JSON.parse(sessionStorage.getItem(PESERTA_KEY) || 'null');
    } catch {
      peserta = null;
    }
    if (!peserta) return;

    const nama = document.querySelector('[data-peserta-nama]');
    const nomor = document.querySelector('[data-peserta-nomor]');
    if (nama && peserta.nama) nama.textContent = peserta.nama;
    if (nomor && peserta.nomorPeserta) nomor.textContent = peserta.nomorPeserta;
  }

  /* ------------------------------------------------------------- Dashboard */

  const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);

  const tanggalId = (iso) =>
    iso
      ? new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—';

  const BADGE = {
    tersedia: ['Dibuka', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
    berjalan: ['Sedang berjalan', 'bg-amber-50 text-amber-700 ring-amber-200'],
    terjadwal: ['Terjadwal', 'bg-slate-100 text-slate-600 ring-slate-200'],
    ditutup: ['Ditutup', 'bg-slate-100 text-slate-500 ring-slate-200'],
    selesai: ['Selesai', 'bg-pmii-50 text-pmii-700 ring-pmii-100'],
  };

  function kartuUjian(ujian) {
    const [labelBadge, warnaBadge] = BADGE[ujian.status] || BADGE.terjadwal;

    // Satu-satunya kondisi yang boleh memulai/melanjutkan sesi.
    const bisaDikerjakan = ujian.status === 'tersedia' || ujian.status === 'berjalan';
    const aksi = bisaDikerjakan
      ? `<button type="button" data-mulai="${ujian.id}" class="btn-accent btn-sm shrink-0">
           ${ujian.status === 'berjalan' ? 'Lanjutkan Ujian' : 'Mulai Ujian'}
         </button>`
      : `<button type="button" class="btn-outline btn-sm shrink-0" disabled>
           ${ujian.status === 'terjadwal' ? 'Belum Dibuka' : 'Tidak Tersedia'}
         </button>`;

    const rincian = [
      `${ujian.jumlahSoal} soal`,
      `${ujian.durasiMenit} menit`,
      ujian.status === 'terjadwal' && ujian.bukaAt
        ? `Dibuka ${tanggalId(ujian.bukaAt)}`
        : `Kesempatan tersisa: ${ujian.sisaPercobaan}`,
      ujian.skorTerbaik != null ? `Skor terbaik: ${ujian.skorTerbaik}` : null,
    ].filter(Boolean);

    return `
      <article class="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-display text-base font-bold">${escapeHtml(ujian.nama)}</h3>
            <span class="badge ring-1 ring-inset ${warnaBadge}">${labelBadge}</span>
          </div>
          <p class="mt-1.5 text-sm text-slate-600">${rincian.join(' · ')}</p>
        </div>
        ${aksi}
      </article>`;
  }

  async function mulaiUjian(paketId, tombol) {
    const labelAsli = tombol.textContent;
    tombol.disabled = true;
    tombol.textContent = 'Menyiapkan…';

    try {
      const hasil = await cbtFetch(`/cbt/ujian/${paketId}/mulai`, { method: 'POST' });
      if (!hasil?.ok) throw new Error(hasil?.message || 'Ujian tidak dapat dimulai.');
      window.location.href = `ujian.html?sesi=${hasil.data.sesiId}`;
    } catch (error) {
      alert(error.message);
      tombol.disabled = false;
      tombol.textContent = labelAsli;
    }
  }

  async function renderDashboard() {
    const wadahUjian = document.querySelector('[data-daftar-ujian]');
    const wadahRiwayat = document.querySelector('[data-riwayat]');
    if (!wadahUjian && !wadahRiwayat) return;

    try {
      const [ujian, hasil] = await Promise.all([cbtFetch('/cbt/ujian'), cbtFetch('/cbt/hasil')]);
      const daftar = ujian?.data || [];
      const riwayat = hasil?.data || [];

      if (wadahUjian) {
        wadahUjian.innerHTML = daftar.length
          ? daftar.map(kartuUjian).join('')
          : '<div class="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-card">Belum ada paket ujian yang dibuka. Pantau pengumuman panitia.</div>';

        wadahUjian.addEventListener('click', (event) => {
          const tombol = event.target.closest('[data-mulai]');
          if (tombol) mulaiUjian(tombol.dataset.mulai, tombol);
        });
      }

      if (wadahRiwayat) {
        wadahRiwayat.innerHTML = riwayat.length
          ? riwayat
              .map(
                (item) => `
                <tr>
                  <td class="px-6 py-4 font-semibold text-pmii-950">${escapeHtml(item.paket)}</td>
                  <td class="px-6 py-4 text-slate-600">${tanggalId(item.submitAt)}</td>
                  <td class="px-6 py-4 text-slate-600">${item.benar}/${item.totalSoal}</td>
                  <td class="px-6 py-4 font-display font-bold text-kuning-600">${item.skor}</td>
                  <td class="px-6 py-4 text-slate-600">${item.peringkat} dari ${item.totalPeserta}</td>
                </tr>`
              )
              .join('')
          : '<tr><td class="px-6 py-4 text-slate-500" colspan="5">Belum ada riwayat pengerjaan.</td></tr>';
      }

      const set = (sel, nilai) => {
        const target = document.querySelector(sel);
        if (target) target.textContent = nilai;
      };
      set('[data-stat-tersedia]', daftar.filter((u) => u.status === 'tersedia' || u.status === 'berjalan').length);
      set('[data-stat-dikerjakan]', riwayat.length);
      set('[data-stat-skor]', riwayat.length ? Math.max(...riwayat.map((r) => r.skor || 0)) : '—');
      set(
        '[data-stat-peringkat]',
        riwayat.length ? Math.min(...riwayat.map((r) => r.peringkat || Infinity)) : '—'
      );
    } catch (error) {
      console.error('[cbt] gagal memuat dashboard:', error.message);
      if (wadahUjian) {
        wadahUjian.innerHTML =
          '<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Gagal memuat data ujian. Periksa koneksi lalu muat ulang halaman.</div>';
      }
    }
  }

  function init() {
    if (!getToken()) {
      // Tanpa token, dashboard tidak boleh ditampilkan.
      window.location.replace('login.html');
      return;
    }

    renderPeserta();
    renderDashboard();
    document.querySelectorAll('[data-logout]').forEach((button) =>
      button.addEventListener('click', logout)
    );
  }

  // Diekspos agar kode halaman ujian dapat memakainya.
  window.PMII_CBT = { cbtFetch, logout, getToken };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
