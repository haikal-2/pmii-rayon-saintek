/**
 * Fondasi panel admin: autentikasi, pemanggilan API, dan utilitas bersama.
 *
 * Semua halaman /admin/* memuat berkas ini. Halaman login memakainya untuk
 * menukar kredensial menjadi token; halaman lain memakainya sebagai penjaga
 * akses dan penyedia `PMII_ADMIN.api()`.
 *
 * Penyimpanan token: sessionStorage. Token hilang saat tab ditutup — pilihan
 * yang disengaja karena panel admin sering dibuka di komputer sekretariat yang
 * dipakai bergantian. Untuk pengetatan lebih lanjut, pindahkan refresh token ke
 * cookie HttpOnly (lihat docs/KEAMANAN.md bagian 2).
 */
(function () {
  'use strict';

  const CONFIG = window.PMII_CONFIG || {};
  const API_BASE = `${CONFIG.apiBaseUrl || ''}${CONFIG.apiPrefix || '/api/v1'}`;
  const TOKEN_KEY = 'pmii_admin_token';
  const USER_KEY = 'pmii_admin_user';

  const getToken = () => sessionStorage.getItem(TOKEN_KEY);
  const getUser = () => {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  };

  /** Path login relatif terhadap posisi halaman saat ini (semua di /admin/). */
  const LOGIN_URL = 'login.html';

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    window.location.replace(LOGIN_URL);
  }

  /** Pemanggil API dengan Bearer token; 401 otomatis mengeluarkan pengguna. */
  async function api(path, options = {}) {
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
      throw new Error('Sesi berakhir. Silakan masuk kembali.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `Permintaan gagal (HTTP ${response.status}).`);
      error.errors = payload.errors;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /* ------------------------------------------------------------- Utilitas */

  const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);

  /** Tanggal dari SQLite (UTC tanpa penanda zona) ke format Indonesia. */
  function tanggal(nilai, denganJam = false) {
    if (!nilai) return '—';
    const iso = nilai.includes('T') ? nilai : `${nilai.replace(' ', 'T')}Z`;
    const opsi = { day: 'numeric', month: 'short', year: 'numeric' };
    if (denganJam) Object.assign(opsi, { hour: '2-digit', minute: '2-digit' });
    return new Date(iso).toLocaleString('id-ID', opsi);
  }

  /** Notifikasi ringkas di pojok kanan bawah. */
  function toast(pesan, jenis = 'sukses') {
    const el = document.querySelector('[data-toast]');
    if (!el) return;

    el.hidden = false;
    el.className = `fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-semibold shadow-card-hover ${
      jenis === 'sukses' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
    }`;
    el.textContent = pesan;

    clearTimeout(el.dataset.timer);
    el.dataset.timer = setTimeout(() => (el.hidden = true), 4000);
  }

  /**
   * Dialog konfirmasi berbasis Promise.
   * Mengembalikan { catatan } bila dikonfirmasi, atau null bila dibatalkan.
   */
  function konfirmasi({ judul, pesan, labelKonfirmasi = 'Konfirmasi', gaya = 'btn-primary' }) {
    const dialog = document.querySelector('[data-dialog]');
    if (!dialog) return Promise.resolve({ catatan: '' });

    const tombolYa = dialog.querySelector('[data-dialog-konfirmasi]');
    const tombolBatal = dialog.querySelector('[data-dialog-batal]');
    const catatan = dialog.querySelector('[data-dialog-catatan]');

    dialog.querySelector('[data-dialog-judul]').textContent = judul;
    dialog.querySelector('[data-dialog-pesan]').textContent = pesan;
    tombolYa.textContent = labelKonfirmasi;
    tombolYa.className = `${gaya} w-full sm:w-auto`;
    if (catatan) catatan.value = '';
    dialog.hidden = false;

    return new Promise((resolve) => {
      const selesai = (hasil) => {
        dialog.hidden = true;
        tombolYa.removeEventListener('click', keYa);
        tombolBatal.removeEventListener('click', keBatal);
        resolve(hasil);
      };
      const keYa = () => selesai({ catatan: catatan ? catatan.value.trim() : '' });
      const keBatal = () => selesai(null);

      tombolYa.addEventListener('click', keYa);
      tombolBatal.addEventListener('click', keBatal);
    });
  }

  /** Unduh data sebagai berkas CSV (dibuka di Excel/Google Sheets). */
  function unduhCsv(namaBerkas, baris) {
    const escapeCsv = (nilai) => `"${String(nilai ?? '').replace(/"/g, '""')}"`;
    const isi = baris.map((kolom) => kolom.map(escapeCsv).join(',')).join('\r\n');

    // BOM UTF-8 agar huruf beraksen tidak rusak saat dibuka di Excel Windows.
    const blob = new Blob([`\uFEFF${isi}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const tautan = Object.assign(document.createElement('a'), { href: url, download: namaBerkas });
    tautan.click();
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------ Halaman login */

  function pasangLogin() {
    const form = document.querySelector('[data-admin-login]');
    if (!form) return false;

    // Sudah punya token? Langsung ke dashboard.
    if (getToken()) window.location.replace('index.html');

    form.setAttribute('novalidate', 'novalidate');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const alert = form.querySelector('[data-form-alert]');
      const tombol = form.querySelector('[data-submit]');
      const email = form.email.value.trim();
      const password = form.password.value;

      alert.hidden = true;
      tombol.disabled = true;
      tombol.textContent = 'Memproses…';

      try {
        const response = await fetch(`${API_BASE}/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) throw new Error(payload.message || 'Email atau kata sandi salah.');

        sessionStorage.setItem(TOKEN_KEY, payload.data.accessToken);
        sessionStorage.setItem(USER_KEY, JSON.stringify(payload.data.user));
        window.location.href = 'index.html';
      } catch (error) {
        alert.hidden = false;
        alert.className =
          'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700';
        alert.textContent = error.message;
        tombol.disabled = false;
        tombol.textContent = 'Masuk';
      }
    });

    return true;
  }

  /* ------------------------------------------------- Halaman ber-sidebar */

  function pasangShell() {
    const user = getUser();
    if (user) {
      const set = (sel, nilai) => {
        const el = document.querySelector(sel);
        if (el) el.textContent = nilai;
      };
      set('[data-user-nama]', user.nama);
      set('[data-user-role]', user.role.replace(/_/g, ' '));
      set('[data-user-inisial]', (user.nama || 'A').trim().charAt(0).toUpperCase());
    }

    document
      .querySelectorAll('[data-admin-logout]')
      .forEach((tombol) => tombol.addEventListener('click', logout));

    // Lencana jumlah pekerjaan yang menunggu, agar pengurus tahu ada antrean
    // tanpa harus membuka setiap halaman.
    api('/admin/ringkasan')
      .then(({ data }) => {
        const isi = (nama, jumlah) => {
          const el = document.querySelector(`[data-badge="${nama}"]`);
          if (!el || !jumlah) return;
          el.hidden = false;
          el.textContent = jumlah > 99 ? '99+' : jumlah;
        };
        isi('mapaba', data.mapaba?.menunggu);
        isi('advokasi', data.pengaduan?.baru);
      })
      .catch(() => {
        /* Lencana bersifat hiasan; kegagalan diabaikan diam-diam. */
      });
  }

  function init() {
    if (pasangLogin()) return;

    if (!getToken()) {
      window.location.replace(LOGIN_URL);
      return;
    }
    pasangShell();
  }

  window.PMII_ADMIN = { api, logout, getUser, getToken, escapeHtml, tanggal, toast, konfirmasi, unduhCsv };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
