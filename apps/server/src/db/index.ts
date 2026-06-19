import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

const createDrizzle = (binding: D1Database) => drizzle(binding, { schema });

const noopConn = {
  end: async () => {},
};

export const createDb = (binding: D1Database) => {
  const db = createDrizzle(binding);
  return { db, conn: noopConn };
};

export type DB = ReturnType<typeof createDrizzle>;
