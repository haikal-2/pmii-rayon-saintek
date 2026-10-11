const ENTITY = 'mapaba_pendaftar';

function logError(error) {
  return `network failure (${error?.name || 'Error'})`;
}

async function recordNotification(env, {
  channel,
  destination,
  subject,
  entityId,
  status,
  error = null,
}) {
  try {
    await env.DB.prepare(
      `INSERT INTO notification_log
         (channel, destination, subject, entity, entity_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(channel, destination, subject, ENTITY, String(entityId), status, error)
      .run();
  } catch (caught) {
    console.error('[notifications] log write failed:', caught?.name || 'Error');
  }
}

async function sendHttpNotification(env, {
  channel,
  destination,
  subject,
  entityId,
  url,
  init,
}) {
  let status = 'terkirim';
  let error = null;
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      status = 'gagal';
      error = `HTTP ${response.status}`;
    }
  } catch (caught) {
    status = 'gagal';
    error = logError(caught);
    console.error(`[notifications] ${channel} delivery failed:`, caught?.name || 'Error');
  }

  await recordNotification(env, {
    channel,
    destination,
    subject,
    entityId,
    status,
    error,
  });
}

async function skipNotification(env, details, reason) {
  await recordNotification(env, { ...details, status: 'dilewati', error: reason });
}

function submissionData(registration) {
  return {
    nomorRegistrasi: registration.nomorRegistrasi,
    namaLengkap: registration.namaLengkap,
    nim: registration.nim,
    angkatan: registration.angkatan,
    universitas: registration.universitas,
    fakultas: registration.fakultas,
    prodi: registration.prodi,
    jenisKelamin: registration.jenisKelamin,
    whatsapp: registration.whatsapp,
    email: registration.email,
    asalDaerah: registration.asalDaerah || '',
    motivasi: registration.motivasi,
    riwayatOrganisasi: registration.riwayatOrganisasi || '',
    sumberInformasi: registration.sumberInformasi || '',
  };
}

async function sendSubmissionEmail(env, registration) {
  const details = {
    channel: 'email',
    destination: 'mapaba-panitia',
    subject: 'Pendaftaran MAPABA baru',
    entityId: registration.id,
  };
  if (!env.RESEND_API_KEY || !env.MAPABA_NOTIFY_EMAIL || !env.MAIL_FROM) {
    await skipNotification(env, details, 'Email notification is not configured.');
    return;
  }

  const detailsText = Object.entries(submissionData(registration))
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  await sendHttpNotification(env, {
    ...details,
    url: 'https://api.resend.com/emails',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [env.MAPABA_NOTIFY_EMAIL],
        subject: details.subject,
        text: `Pendaftar MAPABA baru\n\n${detailsText}`,
      }),
    },
  });
}

async function sendSubmissionWhatsApp(env, registration) {
  const details = {
    channel: 'whatsapp',
    destination: 'registrant-whatsapp',
    subject: 'Pendaftaran MAPABA diterima',
    entityId: registration.id,
  };
  if (!env.WA_API_URL || !env.WA_API_TOKEN || !registration.whatsapp) {
    await skipNotification(env, details, 'WhatsApp notification is not configured.');
    return;
  }

  await sendHttpNotification(env, {
    ...details,
    url: env.WA_API_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: env.WA_API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target: registration.whatsapp,
        message:
          `Salam Pergerakan, ${registration.namaLengkap}!\n\n` +
          `Pendaftaran MAPABA kamu sudah kami terima.\n` +
          `Nomor registrasi: ${registration.nomorRegistrasi}\n` +
          'Panitia akan menghubungimu untuk verifikasi berkas.',
        countryCode: '62',
      }),
    },
  });
}

async function sendSubmissionSheet(env, registration) {
  const details = {
    channel: 'google_sheets',
    destination: 'google-sheets-mapaba',
    subject: 'Pendaftaran MAPABA baru',
    entityId: registration.id,
  };
  if (!env.GOOGLE_SHEETS_MAPABA_WEBHOOK_URL) {
    await skipNotification(env, details, 'Google Sheets notification is not configured.');
    return;
  }

  await sendHttpNotification(env, {
    ...details,
    url: env.GOOGLE_SHEETS_MAPABA_WEBHOOK_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form: 'mapaba', ...submissionData(registration) }),
    },
  });
}

function schedule(ctx, tasks) {
  const pending = Promise.all(tasks.map((task) => task()));
  if (typeof ctx?.waitUntil === 'function') {
    try {
      ctx.waitUntil(pending);
    } catch (error) {
      console.error('[notifications] background task scheduling failed:', error?.name || 'Error');
    }
  }
  return pending;
}

export function notifyMapabaSubmission(ctx, env, registration) {
  return schedule(ctx, [
    () => sendSubmissionEmail(env, registration),
    () => sendSubmissionWhatsApp(env, registration),
    () => sendSubmissionSheet(env, registration),
  ]);
}

async function sendStatusEmail(env, registration, status, note) {
  const details = {
    channel: 'email',
    destination: 'registrant-email',
    subject: 'Status MAPABA diperbarui',
    entityId: registration.id,
  };
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !registration.email) {
    await skipNotification(env, details, 'Email notification is not configured.');
    return;
  }

  const decision = status === 'terverifikasi' ? 'diterima' : 'belum dapat diterima';
  await sendHttpNotification(env, {
    ...details,
    url: 'https://api.resend.com/emails',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [registration.email],
        subject: details.subject,
        text:
          `Pendaftaran MAPABA ${registration.nomorRegistrasi} ${decision}.` +
          (note ? `\nCatatan panitia: ${note}` : ''),
      }),
    },
  });
}

async function sendStatusWhatsApp(env, registration, status) {
  const details = {
    channel: 'whatsapp',
    destination: 'registrant-whatsapp',
    subject: 'Status MAPABA diperbarui',
    entityId: registration.id,
  };
  if (!env.WA_API_URL || !env.WA_API_TOKEN || !registration.whatsapp) {
    await skipNotification(env, details, 'WhatsApp notification is not configured.');
    return;
  }

  const message =
    status === 'terverifikasi'
      ? `Salam Pergerakan, ${registration.namaLengkap}! Pendaftaran MAPABA ${registration.nomorRegistrasi} telah diterima.`
      : `Salam Pergerakan, ${registration.namaLengkap}. Hubungi panitia untuk informasi mengenai pendaftaran MAPABA ${registration.nomorRegistrasi}.`;
  await sendHttpNotification(env, {
    ...details,
    url: env.WA_API_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: env.WA_API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: registration.whatsapp, message, countryCode: '62' }),
    },
  });
}

export function notifyMapabaStatus(ctx, env, registration, status, note) {
  if (status !== 'terverifikasi' && status !== 'ditolak') return Promise.resolve();
  return schedule(ctx, [
    () => sendStatusEmail(env, registration, status, note),
    () => sendStatusWhatsApp(env, registration, status),
  ]);
}
