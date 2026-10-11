const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

async function runFormSubmission(endpoint, config, responsePayload = { ok: true, data: {} }) {
  let submitHandler;
  let requestUrl;
  const alert = { hidden: true, textContent: '', setAttribute() {} };
  const button = { disabled: false, innerHTML: 'Kirim', dataset: {} };
  const ticket = { textContent: '' };
  const trackingCode = { textContent: '' };
  const wrapper = { classList: { add() {} }, querySelector: () => null };
  const panel = {
    hidden: true,
    querySelector(selector) {
      if (selector === '[data-ticket]') return ticket;
      if (selector === '[data-tracking-code]') return trackingCode;
      return null;
    },
    scrollIntoView() {},
  };
  const form = {
    dataset: { apiForm: endpoint },
    querySelector: (selector) => {
      if (selector === '[data-submit]') return button;
      if (selector === '[data-form-alert]') return alert;
      return null;
    },
    querySelectorAll: () => [],
    closest: () => wrapper,
    addEventListener(type, listener) {
      if (type === 'submit') submitHandler = listener;
    },
    setAttribute() {},
    reset() {},
  };
  const context = {
    FormData: class {
      forEach() {}
    },
    document: {
      readyState: 'complete',
      querySelector: (selector) => (selector === '[data-form-success]' ? panel : null),
      querySelectorAll: (selector) => (selector === 'form[data-api-form]' ? [form] : []),
    },
    fetch: async (url) => {
      requestUrl = url;
      return { ok: true, json: async () => responsePayload };
    },
    window: { PMII_CONFIG: config, addEventListener() {} },
    setInterval: () => 1,
    clearInterval() {},
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/assets/js/forms.js'), 'utf8'), context);
  await submitHandler({ preventDefault() {} });
  return { requestUrl, ticket: ticket.textContent, trackingCode: trackingCode.textContent };
}

function runUploaderEndpoints(config) {
  const endpoints = [];
  function uploader(target, apiBase) {
    const inputListeners = {};
    const input = {
      files: [{ name: 'test.jpg', size: 4, type: 'image/jpeg' }],
      addEventListener(type, listener) {
        inputListeners[type] = listener;
      },
    };
    const preview = { classList: { remove() {}, add() {} }, innerHTML: '' };
    const dropzone = { classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {} };
    const wrapper = {
      dataset: { uploaderTarget: target, uploaderApiBase: apiBase },
      querySelector(selector) {
        return selector === '[data-uploader-input]'
          ? input
          : selector === '[data-uploader-preview]'
            ? preview
            : dropzone;
      },
      addEventListener() {},
    };
    return { wrapper, input, inputListeners };
  }

  const mapaba = uploader('pasFotoUrl', 'mapaba');
  const legacy = uploader('lampiranUrl', '');
  class XMLHttpRequestMock {
    constructor() {
      this.upload = { addEventListener() {} };
    }
    open(method, url) {
      endpoints.push({ method, url });
    }
    addEventListener() {}
    send() {}
  }
  class FileReaderMock {
    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,dGVzdA==';
      this.onload();
    }
  }
  class FormDataMock {
    append() {}
  }
  const context = {
    document: {
      readyState: 'complete',
      querySelectorAll: (selector) =>
        selector === '[data-uploader]' ? [mapaba.wrapper, legacy.wrapper] : [],
      querySelector: () => null,
    },
    window: { PMII_CONFIG: config },
    XMLHttpRequest: XMLHttpRequestMock,
    FileReader: FileReaderMock,
    FormData: FormDataMock,
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/assets/js/uploader.js'), 'utf8'), context);
  mapaba.inputListeners.change();
  legacy.inputListeners.change();
  return endpoints;
}

async function runAdminMapaba(
  config,
  token,
  { failure, filePath, storedToken = false, statusId, confirmStatus = false } = {}
) {
  const requests = [];
  const apiCalls = [];
  let tableClickHandler;
  let objectUrl;
  let openedCount = 0;
  const toastMessages = [];
  const tab = { location: { href: '' }, close() {} };
  const selectors = [
    '[data-tabel]',
    '[data-info-halaman]',
    '[data-hal-sebelumnya]',
    '[data-hal-berikutnya]',
    '[data-stat-total]',
    '[data-stat-menunggu]',
    '[data-stat-diterima]',
    '[data-stat-kuota]',
    '[data-worker-admin-form]',
    '[data-worker-admin-token]',
    '[data-worker-admin-error]',
  ];
  const elements = new Map(
    selectors.map((selector) => [
      selector,
      {
        hidden: false,
        disabled: false,
        value: '',
        textContent: '',
        innerHTML: '',
        dataset: {},
        className: '',
        addEventListener(type, listener) {
          if (selector === '[data-tabel]' && type === 'click') tableClickHandler = listener;
        },
        setAttribute() {},
      },
    ])
  );
  const storage = new Map(
    storedToken ? [['pmii_worker_admin_token', token]] : []
  );
  let submitHandler;
  elements.get('[data-worker-admin-form]').addEventListener = (type, listener) => {
    if (type === 'submit') submitHandler = listener;
  };
  const tokenInput = elements.get('[data-worker-admin-token]');
  const context = {
    document: {
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: () => [],
    },
    window: {
      location: { origin: 'https://site.example' },
      PMII_CONFIG: config,
      PMII_ADMIN: {
        escapeHtml: String,
        tanggal: () => '',
        toast: (message) => toastMessages.push(message),
        konfirmasi: async () => (confirmStatus ? { catatan: 'Catatan uji.' } : null),
        unduhCsv() {},
        api: async (apiPath, options) => {
          apiCalls.push({ path: apiPath, options });
          if (apiPath === '/admin/ringkasan') {
            return {
              data: {
                mapaba: { total: 0, menunggu: 0, terverifikasi: 0 },
              },
            };
          }
          if (apiPath === '/mapaba/gelombang-aktif') {
            return { data: { sisaKuota: 4 } };
          }
          return { data: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
        },
      },
      open: () => {
        openedCount += 1;
        return tab;
      },
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (url, options) => {
      requests.push({ url: String(url), headers: options.headers });
      if (failure === 'network') throw new Error('offline');
      if (failure === 'unauthorized') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ ok: false, message: 'Token access ditolak.' }),
        };
      }
      if (String(url).includes('/files/')) {
        return { ok: true, status: 200, blob: async () => ({ type: 'image/jpeg' }) };
      }
      const payload = String(url).includes('/ringkasan')
        ? { ok: true, data: { total: 0, menunggu: 0, terverifikasi: 0, sisaKuota: null } }
        : { ok: true, data: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
      return { ok: true, status: 200, json: async () => payload };
    },
    URL: Object.assign(class extends URL {}, {
      createObjectURL: (blob) => {
        objectUrl = `blob:${blob.type}`;
        return objectUrl;
      },
      revokeObjectURL() {},
    }),
    URLSearchParams,
    Date,
    setTimeout: () => 1,
    clearTimeout,
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'public/assets/js/admin-mapaba.js'), 'utf8'),
    context
  );
  if (submitHandler && !storedToken) {
    tokenInput.value = token;
    await submitHandler({ preventDefault() {} });
  }
  if (filePath) {
    await new Promise(setImmediate);
    const fileButton = {
      dataset: { fileUrl: filePath },
      closest: (selector) => (selector === '[data-file-url]' ? fileButton : null),
    };
    tableClickHandler({ target: fileButton });
    await new Promise(setImmediate);
  }
  if (statusId) {
    const statusButton = {
      dataset: { terima: statusId },
      closest: (selector) => (selector === '[data-terima]' ? statusButton : null),
    };
    tableClickHandler({ target: statusButton });
    await new Promise(setImmediate);
    await new Promise(setImmediate);
  }
  return {
    requests,
    apiCalls,
    token: storage.get('pmii_worker_admin_token'),
    kuota: elements.get('[data-stat-kuota]').textContent,
    error: elements.get('[data-worker-admin-error]').textContent,
    openedUrl: tab.location.href,
    objectUrl,
    openedCount,
    toastMessages,
  };
}

function runAdminLogout(initialStorage) {
  const storage = new Map(Object.entries(initialStorage));
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => storage.delete(key),
  };
  const context = {
    document: { readyState: 'loading', addEventListener() {} },
    window: { PMII_CONFIG: {}, location: { replace() {} } },
    sessionStorage,
    fetch: async () => ({ status: 200 }),
    setTimeout,
    clearTimeout,
    URL,
    Blob,
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/assets/js/admin.js'), 'utf8'), context);
  context.window.PMII_ADMIN.logout();
  return Object.fromEntries(storage);
}

const config = {
  apiBaseUrl: 'https://express.example',
  apiPrefix: '/api/v1',
  mapabaApiBaseUrl: 'https://mapaba.example',
  useMockWhenOffline: false,
};

test('routes only MAPABA form submissions to the configured Worker', async () => {
  assert.equal(
    (await runFormSubmission('/mapaba/pendaftaran', config)).requestUrl,
    'https://mapaba.example/api/v1/mapaba/pendaftaran'
  );
  assert.equal(
    (await runFormSubmission('/advokasi/pengaduan', config)).requestUrl,
    'https://express.example/api/v1/advokasi/pengaduan'
  );
});

test('shows the one-time MAPABA tracking code in the registration success panel', async () => {
  const result = await runFormSubmission('/mapaba/pendaftaran', config, {
    ok: true,
    data: {
      nomorRegistrasi: 'MPB-2026-0001',
      kodePelacakan: 'aebdf482-709b-4b42-98aa-c23184a739ca',
    },
  });

  assert.equal(result.ticket, 'MPB-2026-0001');
  assert.equal(result.trackingCode, 'aebdf482-709b-4b42-98aa-c23184a739ca');
});

test('uses the Worker upload endpoint only for MAPABA-marked uploaders', () => {
  assert.deepEqual(runUploaderEndpoints(config), [
    { method: 'POST', url: 'https://mapaba.example/api/v1/upload' },
    { method: 'POST', url: 'https://express.example/api/v1/upload' },
  ]);
});

test('loads MAPABA admin data with its Worker token and displays absent quota as a dash', async () => {
  const result = await runAdminMapaba(config, 'worker-test-token');

  assert.ok(result.requests.some(({ url }) => url === 'https://mapaba.example/api/v1/mapaba/admin/ringkasan'));
  assert.ok(result.requests.some(({ url }) => url.includes('https://mapaba.example/api/v1/mapaba/admin/pendaftar')));
  assert.ok(result.requests.every(({ headers }) => headers.Authorization === 'Bearer worker-test-token'));
  assert.equal(result.token, 'worker-test-token');
  assert.equal(result.kuota, '—');
});

test('uses the Express admin API and direct file URL when the Worker origin is empty', async () => {
  const expressConfig = { ...config, mapabaApiBaseUrl: '' };
  const fileUrl =
    'https://res.cloudinary.com/demo/image/authenticated/v1/pmii-uinsgd/mapaba/2026-10-11/id.jpg';
  const result = await runAdminMapaba(expressConfig, 'worker-secret-token', {
    filePath: fileUrl,
    storedToken: true,
    statusId: '17',
    confirmStatus: true,
  });

  assert.ok(result.apiCalls.some(({ path }) => path.startsWith('/mapaba/admin/pendaftar?')));
  assert.ok(result.apiCalls.some(({ path }) => path === '/admin/ringkasan'));
  assert.ok(result.apiCalls.some(({ path }) => path === '/mapaba/gelombang-aktif'));
  assert.equal(result.requests.length, 0);
  assert.ok(
    result.apiCalls.every(
      ({ options }) => !options?.headers?.Authorization
    )
  );
  assert.ok(
    result.apiCalls.some(
      ({ path, options }) =>
        path === '/mapaba/admin/pendaftar/17' && options?.method === 'PATCH'
    )
  );
  assert.equal(result.openedUrl, fileUrl);
  assert.equal(result.kuota, 4);
});

test('rejects unsafe legacy file URLs instead of opening them in the admin origin', async () => {
  const expressConfig = { ...config, mapabaApiBaseUrl: '' };
  const result = await runAdminMapaba(expressConfig, '', {
    filePath: 'javascript:alert(document.domain)',
  });

  assert.equal(result.openedCount, 0);
  assert.equal(result.openedUrl, '');
  assert.ok(result.toastMessages.includes('Referensi berkas tidak valid.'));
});

test('rejects an unconfigured external origin for legacy MAPABA files', async () => {
  const expressConfig = { ...config, mapabaApiBaseUrl: '' };
  const result = await runAdminMapaba(expressConfig, '', {
    filePath: 'https://attacker.example/mapaba/private.jpg',
  });

  assert.equal(result.openedCount, 0);
  assert.equal(result.openedUrl, '');
});

test('opens legacy MAPABA files from an explicitly configured CDN origin', async () => {
  const expressConfig = {
    ...config,
    mapabaApiBaseUrl: '',
    mapabaFileOrigins: ['https://cdn.example'],
  };
  const fileUrl = 'https://cdn.example/mapaba/2026-10-11/id.jpg';
  const result = await runAdminMapaba(expressConfig, '', { filePath: fileUrl });

  assert.equal(result.openedUrl, fileUrl);
});

test('keeps invalid or unreachable Worker credentials out of session storage and reports the failure', async () => {
  const unauthorized = await runAdminMapaba(config, 'bad-token', { failure: 'unauthorized' });
  assert.equal(unauthorized.token, undefined);
  assert.match(unauthorized.error, /Token access ditolak/);

  const offline = await runAdminMapaba(config, 'worker-token', { failure: 'network' });
  assert.equal(offline.token, undefined);
  assert.match(offline.error, /Tidak dapat menghubungi Worker MAPABA/);
});

test('fetches MAPABA files with the Worker token and opens only the returned blob', async () => {
  const filePath = '/api/v1/mapaba/admin/files/123e4567-e89b-42d3-a456-426614174000';
  const result = await runAdminMapaba(config, 'worker-file-token', {
    filePath,
    storedToken: true,
  });
  const request = result.requests.find(({ url }) => url.endsWith(filePath));

  assert.equal(request.headers.Authorization, 'Bearer worker-file-token');
  assert.equal(request.url, `https://mapaba.example${filePath}`);
  assert.equal(result.openedUrl, 'blob:image/jpeg');
  assert.equal(result.openedUrl, result.objectUrl);
});

test('logout removes both Express and Worker admin session credentials', () => {
  assert.deepEqual(
    runAdminLogout({
      pmii_admin_token: 'express-token',
      pmii_admin_user: '{"role":"superadmin"}',
      pmii_worker_admin_token: 'worker-token',
    }),
    {}
  );
});
