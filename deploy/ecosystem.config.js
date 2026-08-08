/**
 * Konfigurasi PM2 untuk API PK PMII UIN SGD.
 *
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save && pm2 startup
 *
 * Mode `cluster` dipakai agar Node memanfaatkan semua inti CPU dan agar
 * `pm2 reload` dapat mengganti proses satu per satu tanpa waktu mati.
 *
 * PENTING bila memakai SQLite: `instances` harus tetap 1. SQLite dalam mode WAL
 * mengizinkan banyak pembaca tetapi hanya satu penulis, dan beberapa proses yang
 * menulis bersamaan akan saling menunggu hingga `SQLITE_BUSY`. Naikkan
 * `instances` ke 'max' hanya setelah pindah ke MySQL/PostgreSQL.
 */
module.exports = {
  apps: [
    {
      name: 'pmii-api',
      script: 'server/src/index.js',
      cwd: '/var/www/pmii',

      instances: 1,
      exec_mode: 'cluster',

      // Muat ulang otomatis bila memori membengkak (indikasi kebocoran memori).
      max_memory_restart: '400M',

      // Cegah putaran restart tanpa henti saat konfigurasi salah.
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 3000,

      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },

      error_file: '/home/pmii/logs/pmii-api.error.log',
      out_file: '/home/pmii/logs/pmii-api.out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Beri waktu permintaan yang sedang berjalan untuk selesai saat reload
      // — penting agar jawaban peserta CBT tidak terpotong di tengah simpan.
      kill_timeout: 10000,
      listen_timeout: 8000,
      wait_ready: false,
    },
  ],
};
