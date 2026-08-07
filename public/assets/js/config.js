/**
 * Konfigurasi front-end.
 *
 * Ubah `apiBaseUrl` ke domain API produksi saat deploy, misalnya
 * "https://api.pmiiuinbandung.or.id". Selama pengembangan lokal, jalankan
 * `npm run api` (default: http://localhost:4000).
 */
window.PMII_CONFIG = {
  apiBaseUrl: 'http://localhost:4000',
  /** Prefix versi API. */
  apiPrefix: '/api/v1',
  /** Tampilkan respons dummy bila API belum tersedia (untuk demo/preview). */
  useMockWhenOffline: true,
};
