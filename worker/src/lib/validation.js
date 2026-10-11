import { z } from 'zod';

const STATUSES = ['menunggu', 'terverifikasi', 'hadir', 'ditolak', 'batal'];
const WORKER_FILE_REFERENCE =
  /^\/api\/v1\/mapaba\/admin\/files\/[A-Za-z0-9_-]{20,80}$/;

const fileReference = z
  .string()
  .trim()
  .refine((value) => value === '' || WORKER_FILE_REFERENCE.test(value), {
    message: 'Berkas harus berasal dari unggahan Worker.',
  });

const registrationSchema = z.object({
  namaLengkap: z.string().trim().min(3, 'Nama lengkap minimal 3 karakter.').max(100),
  nim: z.string().trim().regex(/^[0-9]{8,15}$/, 'NIM harus berupa 8–15 angka.'),
  angkatan: z.coerce
    .number()
    .int()
    .min(2015, 'Tahun angkatan tidak valid.')
    .max(new Date().getFullYear()),
  universitas: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((value) => value || 'UIN Sunan Gunung Djati Bandung'),
  fakultas: z.string().trim().min(3, 'Fakultas wajib dipilih.').max(80),
  prodi: z.string().trim().min(2, 'Program studi wajib diisi.').max(80),
  jenisKelamin: z.enum(['L', 'P'], {
    errorMap: () => ({ message: 'Pilih jenis kelamin.' }),
  }),
  whatsapp: z
    .string()
    .trim()
    .min(8, 'Nomor WhatsApp minimal 8 digit.')
    .max(20)
    .regex(/^[0-9+\-\s()]+$/, 'Nomor WhatsApp hanya boleh berisi angka dan tanda + - ( ).'),
  email: z.string().trim().email('Format email tidak valid.').max(120),
  asalDaerah: z.string().trim().max(100).optional(),
  motivasi: z.string().trim().min(30, 'Motivasi minimal 30 karakter.').max(1000),
  riwayatOrganisasi: z.string().trim().max(200).optional(),
  sumberInformasi: z
    .enum(['instagram', 'teman', 'website', 'poster', 'lainnya'])
    .optional()
    .or(z.literal('')),
  pasFotoUrl: fileReference.optional(),
  ktmUrl: fileReference.optional(),
  kesediaan: z.literal(true, {
    errorMap: () => ({ message: 'Kesediaan mengikuti seluruh rangkaian wajib dicentang.' }),
  }),
  persetujuanData: z.literal(true, {
    errorMap: () => ({ message: 'Persetujuan pengolahan data wajib dicentang.' }),
  }),
});

const adminQuerySchema = z.object({
  gelombangId: z.coerce.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const statusChangeSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    catatanPanitia: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.status !== undefined || value.catatanPanitia !== undefined, {
    message: 'Tentukan status atau catatan panitia.',
  });

function toFieldErrors(error) {
  const errors = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.') || '_';
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}

function validate(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) return { success: false, errors: toFieldErrors(result.error) };
  return { success: true, data: result.data };
}

export function validateRegistration(input) {
  return validate(registrationSchema, input);
}

export function validateAdminQuery(query) {
  const input =
    query instanceof URLSearchParams ? Object.fromEntries(query.entries()) : query;
  return validate(adminQuerySchema, input);
}

export function validateStatusChange(input) {
  const result = validate(statusChangeSchema, input);
  if (!result.success) return result;

  const data = {};
  if (result.data.status !== undefined) data.status = result.data.status;
  if (result.data.catatanPanitia !== undefined) {
    data.catatanAdmin = result.data.catatanPanitia;
  }

  return { success: true, data };
}
