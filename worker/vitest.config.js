import path from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            RATE_LIMIT_SECRET: 'test-only-rate-limit-secret',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
