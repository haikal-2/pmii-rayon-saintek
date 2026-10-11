/**
 * Konfigurasi front-end.
 *
 * Ubah `apiBaseUrl` ke domain API produksi saat deploy, misalnya
 * "https://api.pmiiuinbandung.or.id". Selama pengembangan lokal, jalankan
 * `npm run api` (default: http://localhost:4000).
 */
window.PMII_CONFIG = {
  apiBaseUrl: 'http://localhost:4000',
  /** Origin Worker MAPABA terpisah; kosong memakai endpoint lama untuk formulir publik. */
  mapabaApiBaseUrl: '',
  /** Origin CDN S3/R2 khusus bila berkas MAPABA Express memakai domain kustom. */
  mapabaFileOrigins: [],
  /** Prefix versi API. */
  apiPrefix: '/api/v1',
  /** Jangan tampilkan sukses tiruan saat API tidak tersedia. */
  useMockWhenOffline: false,

  /**
   * Anti-spam pada formulir publik (Advokasi & MAPABA).
   *
   * provider: 'none' | 'turnstile' | 'recaptcha' | 'recaptcha3'
   * siteKey : kunci publik dari dasbor penyedia
   *
   * Nilai di sini HARUS sama dengan CAPTCHA_PROVIDER di .env server.
   * Cloudflare Turnstile direkomendasikan: gratis tanpa batas, tanpa pelacakan
   * pengguna, dan tidak memblokir pelapor yang memakai VPN.
   */
  captcha: {
    provider: 'none',
    siteKey: '',
  },
};
