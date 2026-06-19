import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createTransport } from 'nodemailer';
import { env } from '../../env';
import { decryptSecret } from '../crypto-utils';
import type { Address } from 'nodemailer/lib/mailer';
import type {
  DeleteAllSpamResponse,
  IOutgoingMessage,
  Label,
  ParsedMessage,
  Sender,
} from '../../types';
import type { CreateDraftData } from '../schemas';
import { wasSentWithTLS } from '../email-utils';
import type {
  MailManager,
  ManualImapSmtpManagerConfig,
  ParsedDraft,
  IGetThreadResponse,
} from './types';

const notImplemented = (method: string): never => {
  throw new Error(`IMAP/SMTP driver method not implemented yet: ${method}`);
};

const toAddress = (sender: Sender): Address => ({
  address: sender.email,
  name: sender.name,
});

const parseAddressList = (value?: string): Sender[] => {
  if (!value) return [];

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*)<([^>]+)>$/);
      if (!match) return { email: entry };
      return {
        name: match[1]?.trim().replace(/^"|"$/g, ''),
        email: match[2]!.trim(),
      };
    });
};

const draftToOutgoing = (data: CreateDraftData): IOutgoingMessage => ({
  to: parseAddressList(data.to),
  cc: parseAddressList(data.cc),
  bcc: parseAddressList(data.bcc),
  subject: data.subject,
  message: data.message,
  attachments: (data.attachments ?? []).map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    lastModified: attachment.lastModified,
    base64: attachment.base64,
  })),
  headers: {},
  threadId: data.threadId ?? undefined,
  fromEmail: data.fromEmail ?? undefined,
});

const encodeOpaque = (value: string) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const decodeOpaque = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
};

const makeThreadId = (mailbox: string, threadKey: string) => `imap:${encodeOpaque(`${mailbox}\n${threadKey}`)}`;

const makeMessageId = (mailbox: string, uid: number) => `imapmsg:${encodeOpaque(`${mailbox}\n${uid}`)}`;

const parseThreadId = (value: string): { mailbox: string; threadKey: string } | null => {
  if (!value.startsWith('imap:')) return null;

  try {
    const decoded = decodeOpaque(value.slice(5));
    const separatorIndex = decoded.indexOf('\n');
    if (separatorIndex === -1) return null;

    return {
      mailbox: decoded.slice(0, separatorIndex),
      threadKey: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
};

const parseMessageId = (value: string): { mailbox: string; uid: number } | null => {
  if (!value.startsWith('imapmsg:')) return null;

  try {
    const decoded = decodeOpaque(value.slice(8));
    const separatorIndex = decoded.indexOf('\n');
    if (separatorIndex === -1) return null;

    return {
      mailbox: decoded.slice(0, separatorIndex),
      uid: Number(decoded.slice(separatorIndex + 1)),
    };
  } catch {
    return null;
  }
};

const mailboxCandidatesForFolder = (folder: string): string[] => {
  const normalized = folder.toLowerCase();

  switch (normalized) {
    case 'inbox':
      return ['INBOX'];
    case 'sent':
      return ['Sent', 'Sent Items', 'Sent Messages', 'INBOX.Sent'];
    case 'draft':
    case 'drafts':
      return ['Drafts', 'Draft'];
    case 'spam':
      return ['Spam', 'Junk', 'Junk E-mail', 'Bulk Mail'];
    case 'bin':
    case 'trash':
      return ['Trash', 'Deleted Messages', 'Deleted Items', 'Bin'];
    case 'archive':
      return ['Archive', 'All Mail'];
    case 'snoozed':
      return ['Snoozed'];
    default:
      return [folder];
  }
};

const normalizeQuery = (query?: string) =>
  (query ?? '')
    .replace(/\b(category:personal|category:social|category:updates|category:forums|category:promotions)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

type HeaderLineLike = { key?: string; line?: string };
type HeaderMapLike = { entries?: () => IterableIterator<[string, unknown]>; get?: (name: string) => unknown };
type AddressValueLike = { name?: string; address?: string };
type AddressCollectionLike = { value?: AddressValueLike[] };
type ParsedAttachmentLike = {
  filename?: string;
  contentType?: string;
  size?: number;
  content?: string | Buffer;
  headers?: HeaderMapLike;
};
type ParsedMailLike = {
  headers?: HeaderMapLike;
  headerLines?: HeaderLineLike[];
  from?: AddressCollectionLike;
  to?: AddressCollectionLike;
  cc?: AddressCollectionLike;
  bcc?: AddressCollectionLike;
  attachments?: ParsedAttachmentLike[];
  html?: string | false;
  textAsHtml?: string;
  text?: string;
  subject?: string;
  date?: Date;
  messageId?: string;
};
type MailboxTreeNode = { path: string; name?: string; specialUse?: string; folders?: MailboxTreeNode[] };
type ImapFetchedMessage = {
  uid: number;
  source?: string | Buffer | Uint8Array | null;
  flags?: string[] | Set<string>;
  internalDate?: Date | string;
};

const firstHeaderValue = (parsed: ParsedMailLike, headerName: string): string | undefined => {
  const lower = headerName.toLowerCase();
  const direct = parsed?.headers?.get?.(lower);

  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct.map((value) => String(value)).join(', ');
  if (direct && typeof direct === 'object' && 'text' in direct && typeof direct.text === 'string') {
    return direct.text;
  }

  const headerLine = parsed?.headerLines?.find?.((line: HeaderLineLike) => line.key === lower);
  if (typeof headerLine?.line === 'string') {
    const separatorIndex = headerLine.line.indexOf(':');
    return separatorIndex === -1 ? undefined : headerLine.line.slice(separatorIndex + 1).trim();
  }

  return undefined;
};

const extractMessageIds = (value?: string): string[] => {
  if (!value) return [];
  const matches = value.match(/<[^>]+>/g);
  if (matches?.length) return matches;

  const trimmed = value.trim();
  return trimmed ? [trimmed] : [];
};

const normalizeMessageId = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, '')}>`;
};

const resolveThreadKey = ({
  messageId,
  references,
  inReplyTo,
  uid,
}: {
  messageId?: string | null;
  references?: string;
  inReplyTo?: string;
  uid: number;
}) => {
  const referenceIds = extractMessageIds(references);
  if (referenceIds.length > 0) return referenceIds[0]!;

  const normalizedInReplyTo = normalizeMessageId(inReplyTo);
  if (normalizedInReplyTo) return normalizedInReplyTo;

  const normalizedMessageId = normalizeMessageId(messageId);
  if (normalizedMessageId) return normalizedMessageId;

  return `uid:${uid}`;
};

const normalizeDate = (value: Date | string | undefined): string => {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
};

const toSenderList = (addresses: AddressCollectionLike | undefined): Sender[] => {
  const values = addresses?.value;
  if (!Array.isArray(values)) return [];

  return values
    .map((entry) => ({
      name: typeof entry?.name === 'string' && entry.name.trim().length > 0 ? entry.name : undefined,
      email: typeof entry?.address === 'string' ? entry.address : '',
    }))
    .filter((entry) => entry.email.length > 0);
};

const attachmentHeadersToArray = (headers: HeaderMapLike | undefined): { name: string; value: string }[] => {
  if (!headers?.entries) return [];

  return Array.from(headers.entries()).map(([name, value]) => ({
    name: String(name),
    value: Array.isArray(value)
      ? value.map((item) => String(item)).join(', ')
      : typeof value === 'string'
        ? value
        : JSON.stringify(value),
  }));
};

const flattenMailboxTree = (node: { folders?: MailboxTreeNode[] } | undefined): MailboxTreeNode[] => {
  const folders = Array.isArray(node?.folders) ? node.folders : [];
  return folders.flatMap((folder) => [folder, ...flattenMailboxTree(folder)]);
};

export const validateManualImapSmtpConnection = async (config: ManualImapSmtpManagerConfig) => {
  const imapClient = new ImapFlow({
    host: config.config.imap.host,
    port: config.config.imap.port,
    secure: config.config.imap.secure,
    auth: {
      user: config.auth.username,
      pass: config.auth.password,
    },
    disableAutoEnable: true,
    logger: false,
  });

  try {
    await imapClient.connect();
  } finally {
    if (imapClient.usable) {
      await imapClient.logout();
    }
  }

  const transport = createTransport({
    host: config.config.smtp.host,
    port: config.config.smtp.port,
    secure: config.config.smtp.secure,
    auth: {
      user: config.auth.username,
      pass: config.auth.password,
    },
  });

  try {
    await transport.verify();
  } finally {
    transport.close();
  }
};

export class ImapSmtpMailManager implements MailManager {
  config: ManualImapSmtpManagerConfig;

  private resolvedPassword?: string;

  constructor(config: ManualImapSmtpManagerConfig) {
    this.config = config;
  }

  // 帳密以 AES-GCM 加密存於 D1；連線前才解密 (memoized)。舊明文值會原樣回傳。
  private async getPassword(): Promise<string> {
    if (this.resolvedPassword === undefined) {
      this.resolvedPassword = await decryptSecret(this.config.auth.password, env.IMAP_ENCRYPTION_KEY);
    }
    return this.resolvedPassword;
  }

  private async createTransport() {
    return createTransport({
      host: this.config.config.smtp.host,
      port: this.config.config.smtp.port,
      secure: this.config.config.smtp.secure,
      auth: {
        user: this.config.auth.username,
        pass: await this.getPassword(),
      },
    });
  }

  private async createImapClient() {
    return new ImapFlow({
      host: this.config.config.imap.host,
      port: this.config.config.imap.port,
      secure: this.config.config.imap.secure,
      auth: {
        user: this.config.auth.username,
        pass: await this.getPassword(),
      },
      disableAutoEnable: true,
      logger: false,
    });
  }

  private buildMailOptions(data: IOutgoingMessage, extraHeaders?: Record<string, string>) {
    return {
      from: data.fromEmail ?? this.config.auth.email,
      to: data.to.map(toAddress),
      cc: data.cc?.map(toAddress),
      bcc: data.bcc?.map(toAddress),
      subject: data.subject,
      html: data.message,
      headers: {
        ...data.headers,
        ...(extraHeaders ?? {}),
      },
      attachments: data.attachments.map((attachment) => ({
        filename: attachment.name,
        content: Buffer.from(attachment.base64, 'base64'),
        contentType: attachment.type,
      })),
    };
  }

  private async buildRawMessage(data: IOutgoingMessage, extraHeaders?: Record<string, string>) {
    const streamTransport = createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

    try {
      const rawResult = await streamTransport.sendMail(this.buildMailOptions(data, extraHeaders));
      return Buffer.isBuffer((rawResult as { message?: unknown }).message)
        ? ((rawResult as { message: Buffer }).message as Buffer)
        : Buffer.from(String((rawResult as { message?: string }).message ?? ''));
    } finally {
      streamTransport.close();
    }
  }

  private async appendSentCopy(raw: Buffer | string, messageDate = new Date()) {
    const client = await this.connectImap();

    try {
      const mailbox = await this.openMailbox(client, 'sent');
      await client.append(mailbox, raw, ['\\Seen'], messageDate);
    } finally {
      if (client.usable) await client.logout();
    }
  }

  private async connectImap() {
    const client = await this.createImapClient();
    await client.connect();
    return client;
  }

  private async openMailbox(client: ImapFlow, folderOrMailbox: string) {
    const candidates = mailboxCandidatesForFolder(folderOrMailbox);
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        await client.mailboxOpen(candidate);
        return (client.mailbox && client.mailbox.path) || candidate;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Unable to open IMAP mailbox for ${folderOrMailbox}`);
  }

  private async fetchMessagesByUids(client: ImapFlow, uids: number[]) {
    if (uids.length === 0) return [] as ImapFetchedMessage[];

    const query = uids.join(',');
    const messages: ImapFetchedMessage[] = [];

    for await (const message of client.fetch(
      query,
      {
        uid: true,
        envelope: true,
        flags: true,
        source: true,
        internalDate: true,
        bodyStructure: true,
      },
      { uid: true },
    )) {
      messages.push(message);
    }

    return messages;
  }

  private async parseImapMessage(message: ImapFetchedMessage, mailbox: string): Promise<ParsedMessage> {
    const rawSource =
      typeof message.source === 'string'
        ? message.source
        : Buffer.isBuffer(message.source)
          ? message.source
          : Buffer.from(message.source ?? '');

    const parsed = (await simpleParser(rawSource)) as ParsedMailLike;

    const referencesHeader = firstHeaderValue(parsed, 'references') || '';
    const inReplyToHeader = firstHeaderValue(parsed, 'in-reply-to') || '';
    const listUnsubscribe = firstHeaderValue(parsed, 'list-unsubscribe');
    const listUnsubscribePost = firstHeaderValue(parsed, 'list-unsubscribe-post');
    const replyToHeader = firstHeaderValue(parsed, 'reply-to');
    const receivedHeaders = parsed.headerLines
      ?.filter((line: HeaderLineLike) => line.key === 'received')
      .map((line: HeaderLineLike) => {
        const raw = typeof line.line === 'string' ? line.line : '';
        const separatorIndex = raw.indexOf(':');
        return separatorIndex === -1 ? '' : raw.slice(separatorIndex + 1).trim();
      }) ?? [];

    const flags = Array.isArray(message.flags)
      ? message.flags
      : message.flags instanceof Set
        ? Array.from(message.flags)
        : [];

    const unread = !flags.includes('\\Seen');
    const isDraft = flags.includes('\\Draft') || mailbox.toLowerCase().includes('draft');
    const tls = wasSentWithTLS(receivedHeaders);

    const htmlBody =
      typeof parsed.html === 'string'
        ? parsed.html
        : typeof parsed.textAsHtml === 'string'
          ? parsed.textAsHtml
          : undefined;
    const textBody = typeof parsed.text === 'string' ? parsed.text : '';
    const decodedBody = htmlBody || textBody;

    const parsedMessageId = normalizeMessageId(parsed.messageId || firstHeaderValue(parsed, 'message-id'));
    const threadKey = resolveThreadKey({
      messageId: parsedMessageId,
      references: referencesHeader,
      inReplyTo: inReplyToHeader,
      uid: Number(message.uid || 0),
    });

    const subject = parsed.subject?.replace(/"/g, '').trim() || '(no subject)';
    const receivedOn = normalizeDate(parsed.date ?? message.internalDate);
    const attachments = (parsed.attachments ?? []).map((attachment: ParsedAttachmentLike, index: number) => ({
      attachmentId: String(index + 1),
      filename: attachment.filename || '',
      mimeType: attachment.contentType || 'application/octet-stream',
      size: Number(attachment.size || attachment.content?.length || 0),
      headers: attachmentHeadersToArray(attachment.headers),
      body: '',
    }));

    return {
      id: makeMessageId(mailbox, Number(message.uid)),
      threadId: makeThreadId(mailbox, threadKey),
      title: textBody.trim().slice(0, 120) || subject,
      subject,
      tags: [
        { id: mailbox, name: mailbox, type: 'system' },
        ...flags.map((flag) => ({ id: String(flag), name: String(flag), type: 'imap-flag' })),
      ],
      sender: toSenderList(parsed.from)[0] ?? { email: this.config.auth.email, name: undefined },
      to: toSenderList(parsed.to),
      cc: toSenderList(parsed.cc).length > 0 ? toSenderList(parsed.cc) : null,
      bcc: toSenderList(parsed.bcc).length > 0 ? toSenderList(parsed.bcc) : null,
      tls,
      listUnsubscribe,
      listUnsubscribePost,
      receivedOn,
      unread,
      body: '',
      processedHtml: '',
      blobUrl: '',
      decodedBody,
      references: referencesHeader || undefined,
      inReplyTo: inReplyToHeader || undefined,
      replyTo: replyToHeader || undefined,
      messageId: parsedMessageId,
      attachments,
      isDraft,
    };
  }

  private matchesQuery(message: ParsedMessage, query?: string) {
    if (!query) return true;

    const normalized = normalizeQuery(query).toLowerCase();
    if (!normalized) return true;

    const haystack = [
      message.subject,
      message.title,
      message.sender.name,
      message.sender.email,
      message.decodedBody,
      ...(message.to ?? []).map((entry) => `${entry.name ?? ''} ${entry.email}`),
      ...(message.cc ?? []).map((entry) => `${entry.name ?? ''} ${entry.email}`),
      ...(message.tags ?? []).map((entry) => entry.name),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalized);
  }

  private async collectThreadMessages(client: ImapFlow, mailbox: string, threadKey: string) {
    const allUids = ((await client.search({ all: true }, { uid: true })) as number[])
      .map((uid) => Number(uid))
      .sort((a, b) => a - b);

    const fetched = await this.fetchMessagesByUids(client, allUids);
    const parsedMessages = await Promise.all(
      fetched.map(async (message) => this.parseImapMessage(message, mailbox)),
    );

    return parsedMessages.filter((message) => {
      const parsedThread = parseThreadId(message.threadId || '');
      return parsedThread?.threadKey === threadKey;
    });
  }

  private async resolveMailboxUids(client: ImapFlow, ids: string[]) {
    const grouped = new Map<string, Set<number>>();

    for (const id of ids) {
      const parsedMessage = parseMessageId(id);
      if (parsedMessage) {
        const mailboxSet = grouped.get(parsedMessage.mailbox) ?? new Set<number>();
        mailboxSet.add(parsedMessage.uid);
        grouped.set(parsedMessage.mailbox, mailboxSet);
        continue;
      }

      const parsedThread = parseThreadId(id);
      if (!parsedThread) continue;

      const mailbox = await this.openMailbox(client, parsedThread.mailbox);
      const threadMessages = await this.collectThreadMessages(client, mailbox, parsedThread.threadKey);
      const mailboxSet = grouped.get(mailbox) ?? new Set<number>();

      for (const message of threadMessages) {
        const messageId = parseMessageId(message.id);
        if (messageId) mailboxSet.add(messageId.uid);
      }

      grouped.set(mailbox, mailboxSet);
    }

    return Array.from(grouped.entries()).map(([mailbox, uids]) => ({
      mailbox,
      uids: Array.from(uids).sort((a, b) => a - b),
    }));
  }

  async getMessageAttachments(id: string): Promise<
    {
      filename: string;
      mimeType: string;
      size: number;
      attachmentId: string;
      headers: { name: string; value: string }[];
      body: string;
    }[]
  > {
    const parsedMessageId = parseMessageId(id);
    if (!parsedMessageId) return [];

    const client = await this.connectImap();

    try {
      await this.openMailbox(client, parsedMessageId.mailbox);
      const fetched = await this.fetchMessagesByUids(client, [parsedMessageId.uid]);
      const message = fetched[0];
      if (!message) return [];

      const rawSource =
        typeof message.source === 'string'
          ? message.source
          : Buffer.isBuffer(message.source)
            ? message.source
            : Buffer.from(message.source ?? '');
      const parsed = (await simpleParser(rawSource)) as ParsedMailLike;

      return (parsed.attachments ?? []).map((attachment: ParsedAttachmentLike, index: number) => ({
        filename: attachment.filename || '',
        mimeType: attachment.contentType || 'application/octet-stream',
        size: Number(attachment.size || attachment.content?.length || 0),
        attachmentId: String(index + 1),
        headers: attachmentHeadersToArray(attachment.headers),
        body: Buffer.from(attachment.content ?? '').toString('base64'),
      }));
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async get(id: string): Promise<IGetThreadResponse> {
    const parsedThreadId = parseThreadId(id);
    if (!parsedThreadId) {
      return {
        messages: [],
        latest: undefined,
        hasUnread: false,
        totalReplies: 0,
        labels: [],
      };
    }

    const client = await this.connectImap();

    try {
      const mailbox = await this.openMailbox(client, parsedThreadId.mailbox);
      const messages = (await this.collectThreadMessages(client, mailbox, parsedThreadId.threadKey)).sort(
        (a, b) => new Date(a.receivedOn).getTime() - new Date(b.receivedOn).getTime(),
      );

      const labelMap = new Map<string, { id: string; name: string }>();
      let hasUnread = false;

      for (const message of messages) {
        if (message.unread) hasUnread = true;
        for (const tag of message.tags) {
          if (!labelMap.has(tag.id)) {
            labelMap.set(tag.id, { id: tag.id, name: tag.name });
          }
        }
      }

      return {
        messages,
        latest: messages.findLast((message) => message.isDraft !== true),
        hasUnread,
        totalReplies: messages.filter((message) => !message.isDraft).length,
        labels: Array.from(labelMap.values()),
      };
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async create(data: IOutgoingMessage): Promise<{ id?: string | null }> {
    const transport = await this.createTransport();

    try {
      const result = await transport.sendMail(this.buildMailOptions(data));
      const raw = await this.buildRawMessage(
        data,
        result.messageId ? { 'Message-ID': result.messageId } : undefined,
      );

      await this.appendSentCopy(raw, new Date());

      return { id: result.messageId ?? null };
    } finally {
      transport.close();
    }
  }

  async sendDraft(_id: string, data: IOutgoingMessage): Promise<void> {
    await this.create(data);
  }

  async createDraft(
    data: CreateDraftData,
  ): Promise<{ id?: string | null; success?: boolean; error?: string }> {
    const outgoing = draftToOutgoing(data);
    const raw = await this.buildRawMessage(outgoing);
    const client = await this.connectImap();

    try {
      const mailbox = await this.openMailbox(client, 'draft');
      const appended = await client.append(mailbox, raw, ['\\Seen', '\\Draft'], new Date());
      const uid = appended && typeof appended.uid === 'number' ? appended.uid : null;

      return {
        id: uid ? makeMessageId(mailbox, uid) : null,
        success: true,
      };
    } catch (error) {
      return {
        id: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async getDraft(id: string): Promise<ParsedDraft> {
    const parsedMessageId = parseMessageId(id);
    if (!parsedMessageId) {
      throw new Error('Invalid IMAP draft id');
    }

    const client = await this.connectImap();

    try {
      await this.openMailbox(client, parsedMessageId.mailbox);
      const fetched = await this.fetchMessagesByUids(client, [parsedMessageId.uid]);
      const message = fetched[0];
      if (!message) {
        throw new Error('Draft not found');
      }

      const rawSource =
        typeof message.source === 'string'
          ? message.source
          : Buffer.isBuffer(message.source)
            ? message.source
            : Buffer.from(message.source ?? '');
      const parsed = await simpleParser(rawSource);

      return {
        id,
        to: toSenderList(parsed.to).map((entry) => entry.email),
        subject: parsed.subject ?? '',
        content:
          typeof parsed.html === 'string'
            ? parsed.html
            : typeof parsed.textAsHtml === 'string'
              ? parsed.textAsHtml
              : parsed.text ?? '',
        rawMessage: {
          internalDate: normalizeDate(parsed.date ?? message.internalDate),
        },
        cc: toSenderList(parsed.cc).map((entry) => entry.email),
        bcc: toSenderList(parsed.bcc).map((entry) => entry.email),
      };
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async listDrafts(params: { q?: string; maxResults?: number; pageToken?: string }): Promise<{
    threads: { id: string; historyId: string | null; $raw: unknown }[];
    nextPageToken: string | null;
  }> {
    const { q, maxResults = 20, pageToken } = params;
    const offset =
      typeof pageToken === 'string' && pageToken.trim().length > 0 ? Number(pageToken) || 0 : 0;

    const client = await this.connectImap();

    try {
      const mailbox = await this.openMailbox(client, 'draft');
      const allUids = ((await client.search({ all: true }, { uid: true })) as number[])
        .map((uid) => Number(uid))
        .sort((a, b) => b - a);
      const selectedUids = allUids.slice(offset, offset + maxResults);
      const fetched = await this.fetchMessagesByUids(client, selectedUids);
      const parsedMessages = await Promise.all(
        fetched.map(async (message) => this.parseImapMessage(message, mailbox)),
      );

      const drafts = parsedMessages
        .filter((message) => this.matchesQuery(message, q))
        .sort((a, b) => new Date(b.receivedOn).getTime() - new Date(a.receivedOn).getTime());

      return {
        threads: drafts.map((draft) => ({
          id: draft.id,
          historyId: draft.threadId ?? null,
          $raw: draft,
        })),
        nextPageToken: offset + selectedUids.length < allUids.length ? String(offset + selectedUids.length) : null,
      };
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async delete(id: string): Promise<void> {
    const client = await this.connectImap();

    try {
      const targets = await this.resolveMailboxUids(client, [id]);
      const trash = mailboxCandidatesForFolder('bin')[0];

      for (const target of targets) {
        await this.openMailbox(client, target.mailbox);
        if (target.uids.length === 0) continue;
        await client.messageMove(target.uids.join(','), trash, { uid: true });
      }
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async deleteDraft(id: string): Promise<void> {
    const parsedMessageId = parseMessageId(id);
    if (!parsedMessageId) return;

    const client = await this.connectImap();

    try {
      await this.openMailbox(client, parsedMessageId.mailbox);
      await client.messageDelete(String(parsedMessageId.uid), { uid: true });
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async list(params: {
    folder: string;
    query?: string;
    maxResults?: number;
    labelIds?: string[];
    pageToken?: string | number;
  }): Promise<{
    threads: { id: string; historyId: string | null; $raw?: unknown }[];
    nextPageToken: string | null;
  }> {
    const { folder, query, maxResults = 100, pageToken } = params;
    const offset =
      typeof pageToken === 'number'
        ? pageToken
        : typeof pageToken === 'string' && pageToken.trim().length > 0
          ? Number(pageToken)
          : 0;

    const client = await this.connectImap();

    try {
      const mailbox = await this.openMailbox(client, folder);
      const allUids = ((await client.search({ all: true }, { uid: true })) as number[])
        .map((uid) => Number(uid))
        .sort((a, b) => b - a);

      const batchSize = Math.max(maxResults * 5, maxResults);
      const selectedUids = allUids.slice(offset, offset + batchSize);
      const fetchedMessages = await this.fetchMessagesByUids(client, selectedUids);
      const parsedMessages = await Promise.all(
        fetchedMessages.map(async (message) => this.parseImapMessage(message, mailbox)),
      );

      const seenThreadIds = new Set<string>();
      const threads: { id: string; historyId: string | null; $raw?: unknown }[] = [];

      for (const message of parsedMessages.sort(
        (a, b) => new Date(b.receivedOn).getTime() - new Date(a.receivedOn).getTime(),
      )) {
        if (!this.matchesQuery(message, query)) continue;
        if (!message.threadId || seenThreadIds.has(message.threadId)) continue;

        seenThreadIds.add(message.threadId);
        threads.push({
          id: message.threadId,
          historyId: message.messageId ?? null,
          $raw: message,
        });

        if (threads.length >= maxResults) break;
      }

      const nextOffset = offset + selectedUids.length;

      return {
        threads,
        nextPageToken: nextOffset < allUids.length ? String(nextOffset) : null,
      };
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async count(): Promise<{ count?: number; label?: string }[]> {
    const folders = ['inbox', 'sent', 'draft', 'spam', 'bin', 'archive'];
    const client = await this.connectImap();

    try {
      const counts: { count?: number; label?: string }[] = [];

      for (const folder of folders) {
        try {
          await this.openMailbox(client, folder);
          counts.push({ label: folder, count: Number((client.mailbox && client.mailbox.exists) || 0) });
        } catch {
          continue;
        }
      }

      return counts;
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async getTokens(code: string): Promise<{
    tokens: { access_token?: string; refresh_token?: string; expiry_date?: number };
  }> {
    void code;
    return notImplemented('getTokens');
  }

  async getUserInfo(): Promise<{ address: string; name: string; photo: string }> {
    return {
      address: this.config.auth.email,
      name: this.config.auth.username,
      photo: '',
    };
  }

  getScope(): string {
    return 'imap smtp';
  }

  async listHistory<T>(historyId: string): Promise<{ history: T[]; historyId: string }> {
    void historyId;
    return notImplemented('listHistory');
  }

  async markAsRead(threadIds: string[]): Promise<void> {
    const client = await this.connectImap();

    try {
      const targets = await this.resolveMailboxUids(client, threadIds);
      for (const target of targets) {
        await this.openMailbox(client, target.mailbox);
        if (target.uids.length === 0) continue;
        await client.messageFlagsAdd(target.uids.join(','), ['\\Seen'], { uid: true });
      }
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async markAsUnread(threadIds: string[]): Promise<void> {
    const client = await this.connectImap();

    try {
      const targets = await this.resolveMailboxUids(client, threadIds);
      for (const target of targets) {
        await this.openMailbox(client, target.mailbox);
        if (target.uids.length === 0) continue;
        await client.messageFlagsRemove(target.uids.join(','), ['\\Seen'], { uid: true });
      }
    } finally {
      if (client.usable) await client.logout();
    }
  }

  normalizeIds(id: string[]): { threadIds: string[] } {
    return { threadIds: id };
  }

  async modifyLabels(id: string[], options: { addLabels: string[]; removeLabels: string[] }): Promise<void> {
    const client = await this.connectImap();

    try {
      const targets = await this.resolveMailboxUids(client, id);
      const add = options.addLabels.map((label) => label.toUpperCase());
      const remove = options.removeLabels.map((label) => label.toUpperCase());

      for (const target of targets) {
        await this.openMailbox(client, target.mailbox);
        if (target.uids.length === 0) continue;

        const range = target.uids.join(',');

        if (add.includes('UNREAD')) {
          await client.messageFlagsRemove(range, ['\\Seen'], { uid: true });
        }

        if (remove.includes('UNREAD')) {
          await client.messageFlagsAdd(range, ['\\Seen'], { uid: true });
        }

        const destination = add.includes('TRASH')
          ? mailboxCandidatesForFolder('bin')[0]
          : add.includes('SPAM') || add.includes('JUNK')
            ? mailboxCandidatesForFolder('spam')[0]
            : add.includes('INBOX')
              ? mailboxCandidatesForFolder('inbox')[0]
              : null;

        if (destination) {
          await client.messageMove(range, destination, { uid: true });
        }
      }
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<string | undefined> {
    const attachments = await this.getMessageAttachments(messageId);
    return attachments.find((attachment) => attachment.attachmentId === attachmentId)?.body;
  }

  async getUserLabels(): Promise<Label[]> {
    const client = await this.connectImap();

    try {
      const tree = await client.listTree();
      return flattenMailboxTree(tree as unknown as { folders?: MailboxTreeNode[] }).map((folder) => ({
        id: folder.path,
        name: folder.name || folder.path,
        type: folder.specialUse ? 'system' : 'user',
      }));
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async getLabel(id: string): Promise<Label> {
    const labels = await this.getUserLabels();
    const existing = labels.find((label) => label.id === id || label.name === id);
    if (existing) return existing;
    return { id, name: id, type: 'user' };
  }

  async createLabel(label: {
    name: string;
    color?: { backgroundColor: string; textColor: string };
  }): Promise<void> {
    const client = await this.connectImap();

    try {
      await client.mailboxCreate(label.name);
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async updateLabel(
    id: string,
    label: { name: string; color?: { backgroundColor: string; textColor: string } },
  ): Promise<void> {
    const client = await this.connectImap();

    try {
      await client.mailboxRename(id, label.name);
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async deleteLabel(id: string): Promise<void> {
    const client = await this.connectImap();

    try {
      await client.mailboxDelete(id);
    } finally {
      if (client.usable) await client.logout();
    }
  }

  async getEmailAliases(): Promise<{ email: string; name?: string; primary?: boolean }[]> {
    return [{ email: this.config.auth.email, name: this.config.auth.username, primary: true }];
  }

  async revokeToken(token: string): Promise<boolean> {
    void token;
    return true;
  }

  async deleteAllSpam(): Promise<DeleteAllSpamResponse> {
    try {
      const spamThreads = await this.list({ folder: 'spam', maxResults: 500 });
      if (spamThreads.threads.length === 0) {
        return { success: true, message: 'No spam emails to delete', count: 0 };
      }

      await this.modifyLabels(
        spamThreads.threads.map((thread) => thread.id),
        { addLabels: ['TRASH'], removeLabels: ['SPAM', 'INBOX'] },
      );

      return {
        success: true,
        message: `Moved ${spamThreads.threads.length} spam emails to trash`,
        count: spamThreads.threads.length,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to delete spam emails',
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getRawEmail(id: string): Promise<string> {
    const parsedThreadId = parseThreadId(id);
    const client = await this.connectImap();

    try {
      const mailbox = await this.openMailbox(client, parsedThreadId?.mailbox ?? 'inbox');

      if (parsedThreadId) {
        const threadMessages = await this.collectThreadMessages(client, mailbox, parsedThreadId.threadKey);
        const latest = threadMessages.at(-1);
        if (!latest?.id) return '';
        id = latest.id;
      }

      const parsedMessageId = parseMessageId(id);
      if (!parsedMessageId) return '';

      if (parsedMessageId.mailbox !== mailbox) {
        await this.openMailbox(client, parsedMessageId.mailbox);
      }

      const fetched = await this.fetchMessagesByUids(client, [parsedMessageId.uid]);
      const message = fetched[0];
      if (!message) return '';

      return Buffer.from(message.source ?? '').toString('utf8');
    } finally {
      if (client.usable) await client.logout();
    }
  }
}

export const createOutgoingFromDraftData = (data: CreateDraftData): IOutgoingMessage =>
  draftToOutgoing(data);
