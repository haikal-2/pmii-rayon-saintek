/**
 * Widget CAPTCHA untuk formulir publik.
 *
 * Menyisipkan widget ke setiap elemen `[data-captcha]` dan menaruh tokennya di
 * input tersembunyi `captchaToken`, yang otomatis ikut terkirim oleh forms.js.
 *
 * Skrip penyedia dimuat hanya bila `PMII_CONFIG.captcha.provider` diisi. Dengan
 * begitu, saat CAPTCHA dimatikan (pengembangan lokal) tidak ada satu pun
 * permintaan ke domain pihak ketiga — halaman tetap ringan dan privasi pelapor
 * tetap terjaga.
 */
(function () {
  'use strict';

  const CONFIG = (window.PMII_CONFIG && window.PMII_CONFIG.captcha) || {};
  const provider = (CONFIG.provider || 'none').toLowerCase();

  const SCRIPTS = {
    turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit',
    recaptcha3: `https://www.google.com/recaptcha/api.js?render=${CONFIG.siteKey}`,
  };

  function muatSkrip(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Gagal memuat ${src}`));
      document.head.appendChild(script);
    });
  }

  function inputToken(wadah) {
    let input = wadah.querySelector('input[name="captchaToken"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'captchaToken';
      wadah.appendChild(input);
    }
    return input;
  }

  /** Turnstile & reCAPTCHA v2: widget terlihat, token diisi lewat callback. */
  function renderWidget(wadah, api) {
    const input = inputToken(wadah);
    const kotak = document.createElement('div');
    wadah.insertBefore(kotak, input);

    api.render(kotak, {
      sitekey: CONFIG.siteKey,
      theme: 'light',
      language: 'id',
      callback: (token) => {
        input.value = token;
      },
      'expired-callback': () => {
        input.value = '';
      },
      'error-callback': () => {
        input.value = '';
      },
    });
  }

  /**
   * reCAPTCHA v3 tidak menampilkan apa pun; token harus diambil ulang tepat
   * sebelum submit karena masa berlakunya hanya dua menit.
   */
  function pasangV3(wadah) {
    const input = inputToken(wadah);
    const form = wadah.closest('form');
    if (!form) return;

    form.addEventListener(
      'submit',
      (event) => {
        if (input.value) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.grecaptcha.ready(() => {
          window.grecaptcha
            .execute(CONFIG.siteKey, { action: 'submit' })
            .then((token) => {
              input.value = token;
              form.requestSubmit();
            });
        });
      },
      true // fase capture: berjalan sebelum handler pengiriman di forms.js
    );
  }

  async function init() {
    const wadah = document.querySelectorAll('[data-captcha]');
    if (!wadah.length) return;

    if (provider === 'none' || !CONFIG.siteKey || !SCRIPTS[provider]) {
      // Sembunyikan tempat widget agar tidak ada kotak kosong di formulir.
      wadah.forEach((el) => (el.hidden = true));
      return;
    }

    try {
      await muatSkrip(SCRIPTS[provider]);
    } catch (error) {
      console.error('[captcha]', error.message);
      wadah.forEach((el) => (el.hidden = true));
      return;
    }

    const api = provider === 'turnstile' ? window.turnstile : window.grecaptcha;
    wadah.forEach((el) => {
      el.hidden = false;
      if (provider === 'recaptcha3') pasangV3(el);
      else if (api) renderWidget(el, api);
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
