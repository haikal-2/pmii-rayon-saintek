/**
 * PK PMII UIN SGD Cab. Kab. Bandung — interaksi UI global.
 *
 * Semua fitur bersifat progressive enhancement: halaman tetap terbaca dan bisa
 * dinavigasi meskipun file ini gagal dimuat.
 */
(function () {
  'use strict';

  const onReady = (fn) =>
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', fn, { once: true })
      : fn();

  /* ---------------------------------------------------------------- Navbar */

  /** Bayangan halus pada header sticky setelah halaman di-scroll. */
  function initHeaderShadow() {
    const header = document.querySelector('[data-header]');
    if (!header) return;

    const update = () => header.classList.toggle('shadow-card', window.scrollY > 8);
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  /** Hamburger menu untuk tampilan mobile & tablet. */
  function initMobileMenu() {
    const toggle = document.querySelector('[data-menu-toggle]');
    const panel = document.querySelector('[data-menu-panel]');
    if (!toggle || !panel) return;

    const iconOpen = toggle.querySelector('[data-icon-open]');
    const iconClose = toggle.querySelector('[data-icon-close]');

    const setOpen = (open) => {
      panel.classList.toggle('hidden', !open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.sr-only').textContent = open ? 'Tutup menu navigasi' : 'Buka menu navigasi';
      iconOpen?.classList.toggle('hidden', open);
      iconClose?.classList.toggle('hidden', !open);
    };

    toggle.addEventListener('click', () =>
      setOpen(toggle.getAttribute('aria-expanded') !== 'true')
    );

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    // Tutup panel saat viewport melebar ke breakpoint desktop (xl).
    const desktop = window.matchMedia('(min-width: 1280px)');
    desktop.addEventListener('change', (event) => event.matches && setOpen(false));
  }

  /** Dropdown "Profil" pada menu desktop. */
  function initDropdowns() {
    const dropdowns = document.querySelectorAll('[data-dropdown]');

    dropdowns.forEach((dropdown) => {
      const trigger = dropdown.querySelector('[data-dropdown-trigger]');
      const menu = dropdown.querySelector('[data-dropdown-menu]');
      const caret = dropdown.querySelector('[data-dropdown-caret]');
      if (!trigger || !menu) return;

      const openClasses = ['visible', 'opacity-100', 'translate-y-0', 'scale-100'];
      const closedClasses = ['invisible', 'opacity-0', 'translate-y-1', 'scale-95'];

      const setOpen = (open) => {
        menu.classList.remove(...(open ? closedClasses : openClasses));
        menu.classList.add(...(open ? openClasses : closedClasses));
        trigger.setAttribute('aria-expanded', String(open));
        caret?.classList.toggle('rotate-180', open);
      };

      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        setOpen(trigger.getAttribute('aria-expanded') !== 'true');
      });

      dropdown.addEventListener('mouseenter', () => setOpen(true));
      dropdown.addEventListener('mouseleave', () => setOpen(false));
      dropdown.addEventListener('focusout', (event) => {
        if (!dropdown.contains(event.relatedTarget)) setOpen(false);
      });

      document.addEventListener('click', (event) => {
        if (!dropdown.contains(event.target)) setOpen(false);
      });
      document.addEventListener('keydown', (event) => event.key === 'Escape' && setOpen(false));
    });
  }

  /** Akordeon: submenu "Profil" di panel mobile, juga dipakai di halaman FAQ. */
  function initAccordions() {
    document.querySelectorAll('[data-accordion]').forEach((accordion) => {
      const trigger = accordion.querySelector('[data-accordion-trigger]');
      const panel = accordion.querySelector('[data-accordion-panel]');
      const caret = accordion.querySelector('[data-accordion-caret]');
      if (!trigger || !panel) return;

      trigger.addEventListener('click', () => {
        const open = trigger.getAttribute('aria-expanded') !== 'true';
        trigger.setAttribute('aria-expanded', String(open));
        panel.classList.toggle('hidden', !open);
        caret?.classList.toggle('rotate-180', open);
      });
    });
  }

  /* -------------------------------------------------------------- Animasi */

  /** Animasi "fade up" saat elemen ber-kelas .reveal masuk viewport. */
  function initReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, index) => {
          if (!entry.isIntersecting) return;
          const delay = Number(entry.target.dataset.revealDelay || index * 70);
          setTimeout(() => entry.target.classList.add('is-visible'), delay);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    items.forEach((item) => observer.observe(item));
  }

  /** Tombol "kembali ke atas" yang muncul setelah scroll cukup jauh. */
  function initBackToTop() {
    const button = document.querySelector('[data-back-to-top]');
    if (!button) return;

    const update = () => {
      const show = window.scrollY > 600;
      button.classList.toggle('pointer-events-none', !show);
      button.classList.toggle('opacity-0', !show);
      button.classList.toggle('translate-y-3', !show);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    button.addEventListener('click', () =>
      window.scrollTo({ top: 0, behavior: 'smooth' })
    );
  }

  /** Tahun berjalan untuk elemen ber-atribut data-current-year. */
  function initCurrentYear() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('[data-current-year]').forEach((el) => (el.textContent = year));
  }

  onReady(() => {
    initHeaderShadow();
    initMobileMenu();
    initDropdowns();
    initAccordions();
    initReveal();
    initBackToTop();
    initCurrentYear();
  });
})();
