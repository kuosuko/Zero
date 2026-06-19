import { type Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || 'local-account',
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || '00000000-0000-0000-0000-000000000001',
    token: process.env.CLOUDFLARE_API_TOKEN || 'local-token',
  },
  out: './src/db/d1-migrations',
  tablesFilter: ['mail0_*'],
} satisfies Config;
