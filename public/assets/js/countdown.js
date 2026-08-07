/**
 * Hitung mundur penutupan pendaftaran (halaman MAPABA Raya).
 *
 * Markup: <div data-countdown="2026-10-10T23:59:59+07:00">
 *           <span data-countdown-days></span> … dst.
 *         </div>
 */
(function () {
  'use strict';

  function start(root) {
    const deadline = new Date(root.dataset.countdown).getTime();
    if (Number.isNaN(deadline)) return;

    const slots = {
      days: root.querySelector('[data-countdown-days]'),
      hours: root.querySelector('[data-countdown-hours]'),
      minutes: root.querySelector('[data-countdown-minutes]'),
      seconds: root.querySelector('[data-countdown-seconds]'),
    };

    const pad = (value) => String(value).padStart(2, '0');

    const tick = () => {
      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        Object.values(slots).forEach((slot) => slot && (slot.textContent = '00'));
        root.insertAdjacentHTML(
          'afterend',
          '<p class="mt-4 rounded-xl bg-white/10 px-4 py-3 text-center text-sm font-semibold text-kuning-300">' +
            'Pendaftaran telah ditutup. Pantau Instagram kami untuk gelombang berikutnya.</p>'
        );
        clearInterval(timer);
        return;
      }

      const totalSeconds = Math.floor(remaining / 1000);
      if (slots.days) slots.days.textContent = pad(Math.floor(totalSeconds / 86400));
      if (slots.hours) slots.hours.textContent = pad(Math.floor((totalSeconds % 86400) / 3600));
      if (slots.minutes) slots.minutes.textContent = pad(Math.floor((totalSeconds % 3600) / 60));
      if (slots.seconds) slots.seconds.textContent = pad(totalSeconds % 60);
    };

    tick();
    const timer = setInterval(tick, 1000);
  }

  const init = () => document.querySelectorAll('[data-countdown]').forEach(start);

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();
})();
