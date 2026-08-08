/**
 * Penanganan formulir (Layanan Advokasi, MAPABA Raya, Login CBT).
 *
 * Cara pakai pada markup:
 *   <form data-api-form="/advokasi/pengaduan" data-success-redirect="...">
 *     <input name="nama" required data-label="Nama lengkap" />
 *     <p class="error-text" data-error-for="nama"></p>
 *     ...
 *     <button type="submit" data-submit>Kirim</button>
 *   </form>
 *   <div data-form-alert></div>          // area pesan error umum
 *   <div data-form-success hidden></div> // panel sukses
 *
 * Validasi dilakukan dua lapis: HTML5 constraint validation di browser dan
 * skema Zod di server (lihat server/src/routes/*.js).
 */
(function () {
  'use strict';

  const CONFIG = window.PMII_CONFIG || {};
  const API_BASE = `${CONFIG.apiBaseUrl || ''}${CONFIG.apiPrefix || '/api/v1'}`;

  const MESSAGES = {
    required: (label) => `${label} wajib diisi.`,
    email: () => 'Format email tidak valid.',
    tooShort: (label, min) => `${label} minimal ${min} karakter.`,
    pattern: (label) => `${label} belum sesuai format yang diminta.`,
    network:
      'Tidak dapat menghubungi server. Periksa koneksi internet Anda lalu coba lagi.',
  };

  function labelOf(field) {
    return (
      field.dataset.label ||
      field.closest('div')?.querySelector('label')?.textContent.replace('*', '').trim() ||
      'Kolom ini'
    );
  }

  function showFieldError(field, message) {
    if (field.type !== 'hidden') {
      field.classList.add('input-error');
      field.setAttribute('aria-invalid', 'true');
    }
    const target = document.querySelector(`[data-error-for="${field.name}"]`);
    if (target) {
      target.textContent = message;
      target.classList.remove('hidden');
    }
  }

  function clearFieldError(field) {
    field.classList.remove('input-error');
    field.removeAttribute('aria-invalid');
    const target = document.querySelector(`[data-error-for="${field.name}"]`);
    if (target) {
      target.textContent = '';
      target.classList.add('hidden');
    }
  }

  function validate(form) {
    const fields = form.querySelectorAll('input[name], select[name], textarea[name]');
    let firstInvalid = null;

    fields.forEach((field) => {
      clearFieldError(field);
      if (field.disabled) return;

      // Input tersembunyi hanya divalidasi bila ditandai wajib — dipakai oleh
      // hasil unggahan (pasFotoUrl/ktmUrl) yang diisi uploader.js.
      if (field.type === 'hidden') {
        if (field.dataset.required !== undefined && !(field.value || '').trim()) {
          showFieldError(field, `${labelOf(field)} wajib diunggah.`);
          firstInvalid = firstInvalid || field;
        }
        return;
      }

      const label = labelOf(field);
      const value = (field.value || '').trim();
      let message = '';

      if (field.required && (field.type === 'checkbox' ? !field.checked : !value)) {
        message = MESSAGES.required(label);
      } else if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        message = MESSAGES.email();
      } else if (value && field.minLength > 0 && value.length < field.minLength) {
        message = MESSAGES.tooShort(label, field.minLength);
      } else if (value && field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
        message = MESSAGES.pattern(label);
      }

      if (message) {
        showFieldError(field, message);
        firstInvalid = firstInvalid || field;
      }
    });

    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return !firstInvalid;
  }

  function setAlert(form, message, tone = 'error') {
    const alert = form.querySelector('[data-form-alert]') || document.querySelector('[data-form-alert]');
    if (!alert) return;

    if (!message) {
      alert.hidden = true;
      alert.textContent = '';
      return;
    }

    alert.hidden = false;
    alert.className =
      tone === 'error'
        ? 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700'
        : 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700';
    alert.textContent = message;
    alert.setAttribute('role', 'alert');
  }

  function setLoading(form, loading) {
    const button = form.querySelector('[data-submit]');
    if (!button) return;

    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML =
        '<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
        '<path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"></path>' +
        '</svg> Memproses…';
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  function collect(form) {
    const data = {};
    new FormData(form).forEach((value, key) => {
      if (key.endsWith('[]')) {
        const name = key.slice(0, -2);
        (data[name] = data[name] || []).push(value);
      } else {
        data[key] = typeof value === 'string' ? value.trim() : value;
      }
    });
    // Checkbox yang tidak tercentang tidak muncul di FormData → set eksplisit.
    form.querySelectorAll('input[type="checkbox"][name]').forEach((box) => {
      if (!box.name.endsWith('[]')) data[box.name] = box.checked;
    });
    return data;
  }

  function showSuccess(form, payload) {
    const panel = document.querySelector('[data-form-success]');
    const redirect = form.dataset.successRedirect;

    // Login CBT: simpan access token agar dashboard dapat memanggil API.
    if (form.dataset.storeToken) {
      const token = payload?.data?.accessToken || payload?.data?.token;
      if (token) sessionStorage.setItem('pmii_cbt_token', token);
      if (payload?.data?.peserta) {
        sessionStorage.setItem('pmii_cbt_peserta', JSON.stringify(payload.data.peserta));
      }
    }

    if (redirect) {
      window.location.href = redirect;
      return;
    }

    if (!panel) {
      setAlert(form, form.dataset.successMessage || 'Data berhasil dikirim.', 'success');
      form.reset();
      return;
    }

    const ticket = panel.querySelector('[data-ticket]');
    if (ticket && payload?.data) {
      ticket.textContent = payload.data.nomorTiket || payload.data.nomorRegistrasi || '—';
    }

    form.closest('[data-form-wrapper]')?.classList.add('hidden');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.reset();
  }

  /** Respons tiruan agar alur UI bisa didemokan tanpa back-end berjalan. */
  function mockResponse(endpoint) {
    const random = Math.floor(1000 + Math.random() * 9000);
    const year = new Date().getFullYear();
    if (endpoint.includes('advokasi')) {
      return { ok: true, data: { nomorTiket: `ADV-${year}-${random}` } };
    }
    if (endpoint.includes('mapaba')) {
      return { ok: true, data: { nomorRegistrasi: `MPB-${year}-${random}` } };
    }
    if (endpoint.includes('cbt')) {
      return {
        ok: true,
        data: {
          accessToken: 'demo-token',
          peserta: { nama: 'Peserta Demo', nomorPeserta: `BIM-${year}-${random}` },
        },
      };
    }
    return { ok: true, data: {} };
  }

  async function submit(form, event) {
    event.preventDefault();
    setAlert(form, '');

    if (!validate(form)) {
      setAlert(form, 'Beberapa kolom masih perlu diperbaiki. Silakan periksa tanda merah di bawah.');
      return;
    }

    const endpoint = form.dataset.apiForm;
    setLoading(form, true);

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: form.dataset.method || 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(collect(form)),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Error validasi per-kolom dari server: { errors: { nama: "..." } }
        if (payload.errors) {
          Object.entries(payload.errors).forEach(([name, message]) => {
            const field = form.querySelector(`[name="${name}"]`);
            if (field) showFieldError(field, message);
          });
        }
        setAlert(form, payload.message || 'Permintaan gagal diproses. Silakan coba lagi.');
        return;
      }

      showSuccess(form, payload);
    } catch (error) {
      if (CONFIG.useMockWhenOffline) {
        console.warn('[PMII] API tidak tersedia, memakai respons tiruan.', error);
        showSuccess(form, mockResponse(endpoint));
        return;
      }
      setAlert(form, MESSAGES.network);
    } finally {
      setLoading(form, false);
    }
  }

  function init() {
    document.querySelectorAll('form[data-api-form]').forEach((form) => {
      form.setAttribute('novalidate', 'novalidate');
      form.addEventListener('submit', (event) => submit(form, event));
      form.querySelectorAll('input[name], select[name], textarea[name]').forEach((field) => {
        field.addEventListener('input', () => clearFieldError(field));
      });
    });

    // Penghitung karakter untuk textarea panjang (kronologi masalah).
    document.querySelectorAll('[data-counter-for]').forEach((counter) => {
      const field = document.getElementById(counter.dataset.counterFor);
      if (!field) return;
      const update = () => {
        counter.textContent = `${field.value.length}/${field.maxLength > 0 ? field.maxLength : '∞'} karakter`;
      };
      field.addEventListener('input', update);
      update();
    });

    // Tombol lihat/sembunyikan password pada halaman login CBT.
    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.togglePassword);
        if (!input) return;
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        button.setAttribute('aria-label', hidden ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
        button.querySelector('[data-eye-open]')?.classList.toggle('hidden', hidden);
        button.querySelector('[data-eye-closed]')?.classList.toggle('hidden', !hidden);
      });
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
