/**
 * Halaman "Laporan Advokasi" pada panel admin.
 *
 * Alur status yang ditegakkan di UI: baru → verifikasi → pendampingan → selesai,
 * dengan "ditolak" sebagai jalan keluar dari tahap mana pun. Tombol yang
 * ditampilkan hanya tahap berikutnya yang masuk akal, supaya pengurus tidak
 * melewati langkah verifikasi.
 */
(function () {
  'use strict';

  const A = window.PMII_ADMIN;
  if (!A) return;

  const q = (sel) => document.querySelector(sel);
  const tabel = q('[data-tabel]');
  if (!tabel) return;

  const state = { status: '', page: 1, limit: 20, total: 0, totalPage: 1 };

  const KATEGORI = {
    akademik: 'Akademik',
    fasilitas: 'Fasilitas Kampus',
    kekerasan_seksual: 'Kekerasan / Pelecehan',
    ukt: 'UKT / Biaya Pendidikan',
    perundungan: 'Perundungan',
    kebebasan_berpendapat: 'Kebebasan Berpendapat',
    ketenagakerjaan: 'Ketenagakerjaan',
    lainnya: 'Lainnya',
  };

  const STATUS = {
    baru: ['Baru', 'bg-red-50 text-red-700 ring-red-200'],
    verifikasi: ['Verifikasi', 'bg-amber-50 text-amber-700 ring-amber-200'],
    pendampingan: ['Pendampingan', 'bg-pmii-50 text-pmii-700 ring-pmii-200'],
    selesai: ['Selesai', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
    ditolak: ['Ditolak', 'bg-slate-100 text-slate-600 ring-slate-200'],
  };

  const PRIORITAS = {
    darurat: 'bg-red-600 text-white ring-red-600',
    tinggi: 'bg-red-50 text-red-700 ring-red-200',
    normal: 'bg-slate-100 text-slate-600 ring-slate-200',
    rendah: 'bg-slate-50 text-slate-500 ring-slate-200',
  };

  /** Tahap berikutnya yang wajar untuk setiap status. */
  const LANJUTAN = {
    baru: [['verifikasi', 'Mulai Verifikasi', 'btn-primary']],
    verifikasi: [['pendampingan', 'Mulai Pendampingan', 'btn-primary']],
    pendampingan: [['selesai', 'Tandai Selesai', 'btn bg-emerald-600 text-white hover:bg-emerald-700']],
    selesai: [],
    ditolak: [],
  };

  function baris(item) {
    const [labelStatus, warnaStatus] = STATUS[item.status] || STATUS.baru;
    const lanjutan = LANJUTAN[item.status] || [];

    const tombol = lanjutan
      .map(
        ([status, label, gaya]) =>
          `<button type="button" data-status="${status}" data-id="${item.id}"
             class="${gaya} px-3 py-1.5 text-xs">${label}</button>`
      )
      .join('');

    const tolak =
      item.status === 'selesai' || item.status === 'ditolak'
        ? ''
        : `<button type="button" data-status="ditolak" data-id="${item.id}"
             class="btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">Tolak</button>`;

    return `
      <tr class="transition-colors hover:bg-slate-50/70">
        <td class="admin-td">
          <span class="font-mono text-xs font-semibold text-pmii-800">${A.escapeHtml(item.nomorTiket)}</span>
          <p class="mt-1 text-xs text-slate-400">${A.tanggal(item.dibuatPada, true)}</p>
        </td>
        <td class="admin-td">
          <p class="font-semibold text-pmii-950">
            ${A.escapeHtml(item.nama)}
            ${item.isAnonim ? '<span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-slate-500">Anonim</span>' : ''}
          </p>
          <p class="mt-0.5 text-xs text-slate-500">${A.escapeHtml(item.kontak)}</p>
        </td>
        <td class="admin-td">${A.escapeHtml(KATEGORI[item.kategori] || item.kategori)}</td>
        <td class="admin-td">
          <span class="pill ring-1 ring-inset ${PRIORITAS[item.prioritas] || PRIORITAS.normal}">${A.escapeHtml(item.prioritas)}</span>
        </td>
        <td class="admin-td"><span class="pill ${warnaStatus}">${labelStatus}</span></td>
        <td class="admin-td text-right">
          <div class="inline-flex flex-wrap justify-end gap-2">${tombol}${tolak}</div>
        </td>
      </tr>`;
  }

  async function muat() {
    tabel.innerHTML = '<tr><td class="admin-td text-slate-500" colspan="6">Memuat laporan…</td></tr>';

    const params = new URLSearchParams({ page: state.page, limit: state.limit });
    if (state.status) params.set('status', state.status);

    try {
      const { data, meta } = await A.api(`/advokasi/admin/pengaduan?${params}`);
      state.total = meta.total;
      state.totalPage = meta.totalPage || 1;

      tabel.innerHTML = data.length
        ? data.map(baris).join('')
        : '<tr><td class="admin-td text-center text-slate-500" colspan="6">Tidak ada laporan pada penyaring ini.</td></tr>';

      q('[data-info-halaman]').textContent = state.total
        ? `Menampilkan ${(state.page - 1) * state.limit + 1}–${Math.min(state.page * state.limit, state.total)} dari ${state.total} laporan`
        : 'Tidak ada data';
      q('[data-hal-sebelumnya]').disabled = state.page <= 1;
      q('[data-hal-berikutnya]').disabled = state.page >= state.totalPage;
    } catch (error) {
      tabel.innerHTML = `<tr><td class="admin-td text-red-600" colspan="6">${A.escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function ubahStatus(id, status) {
    const teks = {
      verifikasi: ['Mulai verifikasi?', 'Tandai bahwa tim sedang menghubungi pelapor untuk memperjelas kronologi.'],
      pendampingan: ['Mulai pendampingan?', 'Tandai bahwa kasus sudah masuk tahap pendampingan aktif.'],
      selesai: ['Tandai selesai?', 'Kasus ditutup. Pastikan hasil akhir sudah disampaikan kepada pelapor.'],
      ditolak: ['Tolak laporan ini?', 'Gunakan bila laporan di luar jangkauan advokasi atau tidak dapat diverifikasi. Isi catatan agar alasannya terekam.'],
    }[status];

    const hasil = await A.konfirmasi({
      judul: teks[0],
      pesan: teks[1],
      labelKonfirmasi: 'Simpan',
      gaya: status === 'ditolak' ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary',
    });
    if (!hasil) return;

    try {
      await A.api(`/advokasi/admin/pengaduan/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, catatanInternal: hasil.catatan || undefined }),
      });
      A.toast('Status laporan diperbarui.');
      muat();
    } catch (error) {
      A.toast(error.message, 'galat');
    }
  }

  tabel.addEventListener('click', (event) => {
    const tombol = event.target.closest('[data-status]');
    if (tombol) ubahStatus(tombol.dataset.id, tombol.dataset.status);
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

  muat();
})();
