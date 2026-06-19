import { EProviders } from '../types';
import type { connection } from '../db/schema';

type ConnectionRecord = typeof connection.$inferSelect | typeof connection.$inferInsert;

export const hasOauthCredentials = (connection: ConnectionRecord) => {
  return Boolean(connection.accessToken && connection.refreshToken);
};

export const hasManualImapSmtpCredentials = (connection: ConnectionRecord) => {
  if (connection.providerId !== EProviders.imap_smtp) return false;

  const authConfig = connection.authConfig as
    | { username?: string | null; password?: string | null }
    | null
    | undefined;
  const providerConfig = connection.providerConfig as
    | {
        imap?: { host?: string | null };
        smtp?: { host?: string | null };
      }
    | null
    | undefined;

  return Boolean(
    authConfig?.username &&
      authConfig?.password &&
      providerConfig?.imap?.host &&
      providerConfig?.smtp?.host,
  );
};

export const isConnectionAuthorized = (connection: ConnectionRecord) => {
  if (connection.providerId === EProviders.imap_smtp) {
    return hasManualImapSmtpCredentials(connection);
  }

  return hasOauthCredentials(connection);
};
