/**
 * Titik masuk server API.
 *
 * Jalankan: `npm run api` (atau `npm run api:dev` untuk mode watch).
 */
require('dotenv').config();

const { app, PREFIX } = require('./app');
const { migrate, DB_PATH } = require('./lib/db');

const PORT = Number(process.env.PORT || 4000);

// Skema bersifat idempoten, jadi aman dijalankan pada setiap start.
migrate();

const server = app.listen(PORT, () => {
  console.log(`API PK PMII UIN SGD siap di http://localhost:${PORT}${PREFIX}`);
  console.log(`Basis data: ${DB_PATH}`);
});

/** Matikan server dengan rapi agar koneksi berjalan tidak terputus paksa. */
const shutdown = (signal) => () => {
  console.log(`\n${signal} diterima, menutup server…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
