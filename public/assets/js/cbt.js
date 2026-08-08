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

  function init() {
    if (!getToken()) {
      // Tanpa token, dashboard tidak boleh ditampilkan.
      window.location.replace('login.html');
      return;
    }

    renderPeserta();
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
