import type { MailManager, ManagerConfig, ManualImapSmtpManagerConfig } from './types';
import { OutlookMailManager } from './microsoft';
import { GoogleMailManager } from './google';
import { ImapSmtpMailManager } from './imap-smtp';
import { EProviders } from '../../types';

const isManualImapSmtpConfig = (
  config: ManagerConfig | ManualImapSmtpManagerConfig,
): config is ManualImapSmtpManagerConfig => {
  return 'config' in config;
};

export const createDriver = (
  provider: string,
  config: ManagerConfig | ManualImapSmtpManagerConfig,
): MailManager => {
  if (provider === EProviders.imap_smtp) {
    if (!isManualImapSmtpConfig(config)) {
      throw new Error('Manual IMAP/SMTP provider requires manual config');
    }
    return new ImapSmtpMailManager(config) as unknown as MailManager;
  }

  if (provider === EProviders.google) {
    return new GoogleMailManager(config as ManagerConfig) as unknown as MailManager;
  }

  if (provider === EProviders.microsoft) {
    return new OutlookMailManager(config as ManagerConfig) as unknown as MailManager;
  }

  throw new Error('Provider not supported');
};
