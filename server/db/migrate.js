#!/usr/bin/env node
/** Jalankan skema basis data. Aman dijalankan berulang kali. */
require('dotenv').config();

const { migrate } = require('../src/lib/db');

const path = migrate();
console.log(`Skema berhasil diterapkan pada ${path}`);
