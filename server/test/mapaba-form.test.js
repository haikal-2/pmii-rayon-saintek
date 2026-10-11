const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

function createClassList() {
  const values = new Set();
  return {
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
  };
}

function registrationState(now) {
  const button = {
    disabled: true,
    textContent: 'Pendaftaran Dibuka 1 Oktober 2026',
    classList: createClassList(),
  };
  const title = { textContent: 'Pendaftaran Belum Dibuka' };
  const banner = {
    hidden: false,
    querySelector: (selector) => (selector === '[data-registration-title]' ? title : null),
  };
  const form = {
    dataset: {
      apiForm: '/mapaba/pendaftaran',
      registrationOpens: '2026-10-01T00:00:00+07:00',
      registrationCloses: '2026-10-28T23:59:59+07:00',
      registrationOpensLabel: '1 Oktober 2026',
      registrationClosesLabel: '28 Oktober 2026',
    },
    querySelector: (selector) => (selector === '[data-submit]' ? button : null),
    querySelectorAll: () => [],
    closest: () => ({ querySelector: () => banner }),
    addEventListener() {},
    setAttribute() {},
  };
  const document = {
    readyState: 'complete',
    querySelectorAll: (selector) =>
      selector === 'form[data-api-form]' ? [form] : [],
  };
  class FixedDate extends Date {
    static now() {
      return now;
    }
  }
  const context = {
    Date: FixedDate,
    document,
    window: { PMII_CONFIG: {}, addEventListener() {} },
    setInterval: () => 1,
    clearInterval() {},
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'public/assets/js/forms.js'), 'utf8'),
    context
  );

  return { button, banner, title };
}

test('pendaftaran hanya aktif di antara tanggal buka dan tutup', () => {
  const before = registrationState(Date.parse('2026-09-30T23:59:00+07:00'));
  assert.equal(before.button.disabled, true);
  assert.equal(before.banner.hidden, false);
  assert.equal(before.title.textContent, 'Pendaftaran Belum Dibuka');
  assert.equal(before.button.textContent, 'Pendaftaran Dibuka 1 Oktober 2026');

  const open = registrationState(Date.parse('2026-10-11T12:00:00+07:00'));
  assert.equal(open.button.disabled, false);
  assert.equal(open.banner.hidden, true);
  assert.equal(open.button.textContent, 'Kirim Pendaftaran');

  const closed = registrationState(Date.parse('2026-10-29T00:00:00+07:00'));
  assert.equal(closed.button.disabled, true);
  assert.equal(closed.banner.hidden, false);
  assert.equal(closed.title.textContent, 'Pendaftaran Ditutup');
  assert.equal(closed.button.textContent, 'Pendaftaran Ditutup');
});

test('fallback demo dinonaktifkan pada konfigurasi form', () => {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'public/assets/js/config.js'), 'utf8'),
    context
  );

  assert.equal(context.window.PMII_CONFIG.useMockWhenOffline, false);
});