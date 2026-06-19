// 最小 raw-socket IMAP client，專為 Cloudflare Workers (workerd) 設計，提供 imapflow 相容介面。
// 背景: imapflow 用 socket.pipe(streamer)+backpressure，在 workerd 上 pause 後 resume 失效，
// 登入後第 3 個指令起資料流停止 → hang。raw node:tls + socket.on('data') 在 workerd 上穩定
// (實測 12+ 次往返正常)。本 client 以 Latin1 字串做二進位安全的 IMAP 協定處理。
// 注意: SMTP 端 (nodemailer) 在 workerd 上正常，不需替換，僅 IMAP 改用本 client。
import tls from 'node:tls';
import net from 'node:net';
import { Buffer } from 'node:buffer';

const CRLF = '\r\n';
const qstr = (s: string) => '"' + String(s).replace(/([\\"])/g, '\\$1') + '"';

type Literals = string[];
type ImapValue = string | null | ImapValue[];

// ── IMAP 回應 tokenizer/parser ─────────────────────────────────────────────
class Tok {
  private s: string;
  private lit: Literals;
  private i = 0;
  constructor(text: string, literals: Literals) { this.s = text; this.lit = literals; }
  eof() { return this.i >= this.s.length; }
  skipSp() { while (this.s[this.i] === ' ') this.i++; }
  parseValue(): ImapValue {
    this.skipSp();
    const c = this.s[this.i];
    if (c === '(') return this.parseList();
    if (c === '"') return this.parseQuoted();
    if (c === '\x00') return this.parseLiteralMarker();
    return this.parseAtom();
  }
  parseList(): ImapValue[] {
    this.i++; const arr: ImapValue[] = []; this.skipSp();
    while (this.s[this.i] !== ')' && !this.eof()) { arr.push(this.parseValue()); this.skipSp(); }
    this.i++; return arr;
  }
  parseQuoted(): string {
    this.i++; let out = '';
    while (this.i < this.s.length) {
      const ch = this.s[this.i++];
      if (ch === '\\') { out += this.s[this.i++]; continue; }
      if (ch === '"') break;
      out += ch;
    }
    return out;
  }
  parseLiteralMarker(): string {
    const m = /^\x00LIT(\d+)\x00/.exec(this.s.slice(this.i));
    if (!m) { this.i++; return ''; }
    this.i += m[0].length; return this.lit[Number(m[1])];
  }
  parseAtom(): string | null {
    let out = '';
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === ' ' || ch === '(' || ch === ')' || ch === '"' || ch === '\x00') break;
      out += ch; this.i++;
    }
    return out === 'NIL' ? null : out;
  }
  parseAll(): ImapValue[] { const arr: ImapValue[] = []; this.skipSp(); while (!this.eof()) { arr.push(this.parseValue()); this.skipSp(); } return arr; }
}

function latin1ToBytes(s: string): Uint8Array { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; }
function bytesToLatin1(u8: Uint8Array): string { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }

export interface RawImapOptions {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  auth?: { user?: string; pass?: string };
  socketTimeout?: number;
  // imapflow 相容 (本 client 忽略，僅為呼叫端介面相容)
  disableAutoEnable?: boolean;
  logger?: unknown;
}

export interface ImapAddress { name?: string | null; mailbox?: string | null; host?: string | null; address: string }
export interface ImapEnvelope {
  date?: string | null; subject?: string | null;
  from: ImapAddress[]; sender: ImapAddress[]; replyTo: ImapAddress[];
  to: ImapAddress[]; cc: ImapAddress[]; bcc: ImapAddress[];
  inReplyTo?: string | null; messageId?: string | null;
}
export interface RawFetchedMessage {
  seq: number; uid: number; flags: Set<string>;
  internalDate?: Date; size?: number; envelope?: ImapEnvelope | null;
  bodyStructure?: ImapValue; source?: Buffer;
}
export interface RawMailboxInfo { path: string; exists: number; uidnext: number; uidvalidity: number }
export interface RawMailboxNode { path: string; name: string; specialUse?: string; folders: RawMailboxNode[] }

interface Pending {
  tag: string;
  resolve: (r: { untagged: { line: string; literals: Literals }[]; status: string; text: string }) => void;
  reject: (e: Error) => void;
  untagged: { line: string; literals: Literals }[];
  onContinuation?: (line: string, literals: Literals) => void;
}

export class RawImapClient {
  private opts: Required<Pick<RawImapOptions, 'host' | 'port' | 'secure' | 'socketTimeout'>> & { user: string; pass: string };
  private sock: import('node:net').Socket | null = null;
  private buf = '';
  private tagN = 0;
  private pending: Pending | null = null;
  greeting: string | null = null;
  private _greetResolve: (() => void) | null = null;
  usable = false;
  mailbox: RawMailboxInfo | false = false;

  constructor(opts: RawImapOptions) {
    const auth = opts.auth || {};
    this.opts = {
      host: opts.host, port: opts.port, secure: opts.secure !== false,
      user: (opts.user || auth.user) ?? '', pass: (opts.pass || auth.pass) ?? '',
      socketTimeout: opts.socketTimeout || 30000,
    };
  }

  private _onData(u8: Uint8Array) { this.buf += bytesToLatin1(u8); this._drain(); }

  private _frame(): { response: string; literals: Literals } | null {
    let pos = 0, out = '';
    const literals: Literals = [];
    for (;;) {
      const nl = this.buf.indexOf(CRLF, pos);
      if (nl === -1) return null;
      const seg = this.buf.slice(pos, nl);
      const m = /\{(\d+)\}$/.exec(seg);
      if (m) {
        const n = Number(m[1]); const litStart = nl + 2;
        if (this.buf.length < litStart + n) return null;
        out += seg.slice(0, seg.length - m[0].length) + `\x00LIT${literals.length}\x00`;
        literals.push(this.buf.slice(litStart, litStart + n));
        pos = litStart + n;
      } else { out += seg; this.buf = this.buf.slice(nl + 2); return { response: out, literals }; }
    }
  }

  private _drain() { let f; while ((f = this._frame())) this._handleResponse(f.response, f.literals); }

  private _handleResponse(line: string, literals: Literals) {
    if (this.greeting === null && (line.startsWith('* OK') || line.startsWith('* PREAUTH'))) {
      this.greeting = line; this.usable = true;
      this._greetResolve?.();
      return;
    }
    if (!this.pending) return;
    const tag = this.pending.tag;
    if (line.startsWith(tag + ' ')) {
      const rest = line.slice(tag.length + 1);
      const status = rest.split(' ')[0];
      const p = this.pending; this.pending = null;
      if (status === 'OK') p.resolve({ untagged: p.untagged, status, text: rest });
      else p.reject(new Error(`IMAP ${status}: ${rest}`));
    } else if (line.startsWith('+')) {
      this.pending.onContinuation?.(line, literals);
    } else if (line.startsWith('* ')) {
      this.pending.untagged.push({ line: line.slice(2), literals });
    }
  }

  private _send(str: string) { this.sock!.write(str); }
  private _sendBytes(u8: Uint8Array) { this.sock!.write(Buffer.from(u8)); }

  exec(command: string, onContinuation?: (line: string, literals: Literals) => void) {
    const tag = 'A' + (++this.tagN);
    return new Promise<{ untagged: { line: string; literals: Literals }[]; status: string; text: string }>((resolve, reject) => {
      this.pending = { tag, resolve, reject, untagged: [], onContinuation };
      this._send(tag + ' ' + command + CRLF);
    });
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const { host, port, secure, socketTimeout } = this.opts;
      const to = setTimeout(() => reject(new Error('greeting timeout')), socketTimeout);
      this._greetResolve = () => { clearTimeout(to); resolve(); };
      const onErr = (e: Error) => { clearTimeout(to); if (this.pending) { this.pending.reject(e); this.pending = null; } else reject(new Error(`socket error: ${e?.message || e}`)); };
      this.sock = secure
        ? tls.connect({ host, port, servername: host }, () => {})
        : net.connect({ host, port }, () => {});
      this.sock.on('data', (d: Uint8Array) => this._onData(d instanceof Uint8Array ? d : new Uint8Array(d)));
      this.sock.on('error', onErr);
      this.sock.on('close', () => { this.usable = false; if (this.pending) { this.pending.reject(new Error('socket closed')); this.pending = null; } });
    });
    await this._login();
  }

  private async _login(): Promise<void> {
    const token = btoa('\x00' + this.opts.user + '\x00' + this.opts.pass);
    try {
      await this.exec('AUTHENTICATE PLAIN', () => this._send(token + CRLF));
    } catch {
      await this.exec(`LOGIN ${qstr(this.opts.user)} ${qstr(this.opts.pass)}`);
    }
  }

  async mailboxOpen(path: string, opts: { readOnly?: boolean } = {}): Promise<RawMailboxInfo> {
    const r = await this.exec(`${opts.readOnly ? 'EXAMINE' : 'SELECT'} ${qstr(path)}`);
    let exists = 0, uidnext = 0, uidvalidity = 0;
    for (const u of r.untagged) {
      let m;
      if ((m = /^(\d+) EXISTS/.exec(u.line))) exists = Number(m[1]);
      if ((m = /UIDNEXT (\d+)/.exec(u.line))) uidnext = Number(m[1]);
      if ((m = /UIDVALIDITY (\d+)/.exec(u.line))) uidvalidity = Number(m[1]);
    }
    this.mailbox = { path, exists, uidnext, uidvalidity };
    return this.mailbox;
  }

  async status(path: string, query: Record<string, boolean> = {}): Promise<Record<string, number> & { path: string }> {
    const items: string[] = [];
    if (query.messages) items.push('MESSAGES');
    if (query.uidNext) items.push('UIDNEXT');
    if (query.uidValidity) items.push('UIDVALIDITY');
    if (query.unseen) items.push('UNSEEN');
    if (!items.length) items.push('MESSAGES');
    const r = await this.exec(`STATUS ${qstr(path)} (${items.join(' ')})`);
    const out: Record<string, number> & { path: string } = { path } as never;
    for (const u of r.untagged) {
      const m = /STATUS [^(]*\(([^)]*)\)/.exec(u.line);
      if (m) { const p = m[1].split(' '); for (let i = 0; i < p.length; i += 2) out[p[i].toLowerCase()] = Number(p[i + 1]); }
    }
    return out;
  }

  async search(query: Record<string, unknown> | string = { all: true }, _opts: { uid?: boolean } = {}): Promise<number[]> {
    const criteria = searchToCriteria(query);
    const r = await this.exec(`UID SEARCH ${criteria}`);
    const uids: number[] = [];
    for (const u of r.untagged) {
      const m = /^SEARCH(.*)$/i.exec(u.line);
      if (m) for (const n of m[1].trim().split(/\s+/).filter(Boolean)) uids.push(Number(n));
    }
    return uids;
  }

  async *fetch(range: string, query: Record<string, boolean> = {}, _opts: { uid?: boolean } = {}): AsyncGenerator<RawFetchedMessage> {
    const items = ['UID'];
    if (query.flags) items.push('FLAGS');
    if (query.internalDate) items.push('INTERNALDATE');
    if (query.size) items.push('RFC822.SIZE');
    if (query.envelope) items.push('ENVELOPE');
    if (query.bodyStructure) items.push('BODYSTRUCTURE');
    if (query.source) items.push('BODY.PEEK[]');
    const r = await this.exec(`UID FETCH ${range} (${items.join(' ')})`);
    for (const u of r.untagged) {
      const m = /^(\d+) FETCH (.*)$/.exec(u.line);
      if (!m) continue;
      const inner = m[2].trim().replace(/^\(/, '').replace(/\)$/, '');
      const flat = new Tok(inner, u.literals).parseAll();
      const msg: RawFetchedMessage = { seq: Number(m[1]), uid: 0, flags: new Set() };
      for (let i = 0; i < flat.length - 1; i += 2) {
        const key = String(flat[i]).toUpperCase();
        const val = flat[i + 1];
        if (key === 'UID') msg.uid = Number(val);
        else if (key === 'FLAGS') msg.flags = new Set(Array.isArray(val) ? (val as string[]) : []);
        else if (key === 'INTERNALDATE') msg.internalDate = parseImapDate(val as string);
        else if (key === 'RFC822.SIZE') msg.size = Number(val);
        else if (key === 'ENVELOPE') msg.envelope = parseEnvelope(val);
        else if (key === 'BODYSTRUCTURE') msg.bodyStructure = val;
        else if (key.startsWith('BODY')) msg.source = Buffer.from(latin1ToBytes(String(val ?? '')));
      }
      yield msg;
    }
  }

  async fetchOne(uid: number, query: Record<string, boolean>, opts?: { uid?: boolean }): Promise<RawFetchedMessage | null> {
    for await (const m of this.fetch(String(uid), query, opts)) return m;
    return null;
  }

  async append(path: string, content: Buffer | Uint8Array | string, flags: string[] = [], date?: Date): Promise<{ uid: number | null; path: string }> {
    const bytes = Buffer.isBuffer(content) || content instanceof Uint8Array
      ? new Uint8Array(content as Uint8Array)
      : latin1ToBytes(String(content));
    const flagStr = flags.length ? ` (${flags.join(' ')})` : '';
    const dateStr = date ? ` ${qstr(formatImapDate(date))}` : '';
    const r = await this.exec(`APPEND ${qstr(path)}${flagStr}${dateStr} {${bytes.length}}`, () => {
      this._sendBytes(bytes); this._send(CRLF);
    });
    const m = /APPENDUID \d+ (\d+)/.exec(r.text || '');
    return { uid: m ? Number(m[1]) : null, path };
  }

  async messageFlagsAdd(range: string, flags: string[], _opts: { uid?: boolean } = {}): Promise<boolean> { await this.exec(`UID STORE ${range} +FLAGS (${flags.join(' ')})`); return true; }
  async messageFlagsRemove(range: string, flags: string[], _opts: { uid?: boolean } = {}): Promise<boolean> { await this.exec(`UID STORE ${range} -FLAGS (${flags.join(' ')})`); return true; }
  async messageMove(range: string, dest: string, _opts: { uid?: boolean } = {}): Promise<boolean> { await this.exec(`UID MOVE ${range} ${qstr(dest)}`); return true; }
  async messageDelete(range: string, _opts: { uid?: boolean } = {}): Promise<boolean> {
    await this.exec(`UID STORE ${range} +FLAGS (\\Deleted)`);
    await this.exec(`UID EXPUNGE ${range}`).catch(async () => { await this.exec('EXPUNGE').catch(() => {}); });
    return true;
  }

  async list(): Promise<{ path: string; name: string; flags: string[]; delimiter: string; specialUse?: string }[]> {
    const r = await this.exec('LIST "" "*"');
    const out: { path: string; name: string; flags: string[]; delimiter: string; specialUse?: string }[] = [];
    for (const u of r.untagged) {
      const m = /^LIST \(([^)]*)\) (?:"([^"]*)"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))/.exec(u.line);
      if (!m) continue;
      const flags = m[1].split(' ').filter(Boolean);
      const delimiter = m[2] || '/';
      const path = (m[3] !== undefined ? m[3].replace(/\\(.)/g, '$1') : m[4]) || '';
      const name = path.split(delimiter).pop() || path;
      const specialUse = flags.find((f) => /^\\(Sent|Drafts|Trash|Junk|Archive|All|Flagged)$/i.test(f));
      out.push({ path, name, flags, delimiter, specialUse });
    }
    return out;
  }

  async listTree(): Promise<RawMailboxNode & { root: boolean }> {
    const flat = await this.list();
    const root = { root: true, path: '', name: '', folders: [] as RawMailboxNode[] };
    const map = new Map<string, RawMailboxNode>();
    for (const f of flat) map.set(f.path, { path: f.path, name: f.name, specialUse: f.specialUse, folders: [] });
    for (const f of flat) {
      const node = map.get(f.path)!;
      const parentPath = f.path.split(f.delimiter || '/').slice(0, -1).join(f.delimiter || '/');
      const parent = parentPath ? map.get(parentPath) : undefined;
      if (parent) parent.folders.push(node); else root.folders.push(node);
    }
    return root;
  }

  async mailboxCreate(path: string | string[]): Promise<{ path: string | string[] }> { await this.exec(`CREATE ${qstr(Array.isArray(path) ? path.join('/') : path)}`); return { path }; }
  async mailboxDelete(path: string): Promise<{ path: string }> { await this.exec(`DELETE ${qstr(path)}`); return { path }; }
  async mailboxRename(from: string, to: string | string[]): Promise<{ path: string | string[] }> { await this.exec(`RENAME ${qstr(from)} ${qstr(Array.isArray(to) ? to.join('/') : to)}`); return { path: to }; }

  async logout(): Promise<void> { try { await this.exec('LOGOUT'); } catch { /* ignore */ } try { this.sock?.destroy(); } catch { /* ignore */ } this.usable = false; }
  async getMailboxLock(path: string): Promise<{ path: string; release: () => void }> { await this.mailboxOpen(path); return { path, release: () => {} }; }
}

// ── helpers ────────────────────────────────────────────────────────────────
function searchToCriteria(q: Record<string, unknown> | string): string {
  if (typeof q === 'string') return q;
  if (!q || q.all) return 'ALL';
  const parts: string[] = [];
  if (q.seen === true) parts.push('SEEN'); if (q.seen === false) parts.push('UNSEEN');
  if (q.flagged) parts.push('FLAGGED');
  if (q.since) parts.push(`SINCE ${formatImapDateOnly(new Date(q.since as string))}`);
  if (q.from) parts.push(`FROM ${qstr(String(q.from))}`);
  if (q.subject) parts.push(`SUBJECT ${qstr(String(q.subject))}`);
  if (q.uid) parts.push(`UID ${q.uid}`);
  return parts.length ? parts.join(' ') : 'ALL';
}

function parseEnvelope(e: ImapValue): ImapEnvelope | null {
  if (!Array.isArray(e)) return null;
  const addr = (list: ImapValue): ImapAddress[] => {
    if (!Array.isArray(list)) return [];
    const out: ImapAddress[] = [];
    for (const a of list) {
      if (!Array.isArray(a)) continue;
      const mailbox = (a[2] as string | null) ?? null;
      const host = (a[3] as string | null) ?? null;
      out.push({
        name: decodeMime(a[0] as string), mailbox, host,
        address: mailbox && host ? `${mailbox}@${host}` : (mailbox || ''),
      });
    }
    return out;
  };
  return {
    date: e[0] as string, subject: decodeMime(e[1] as string),
    from: addr(e[2]), sender: addr(e[3]), replyTo: addr(e[4]), to: addr(e[5]), cc: addr(e[6]), bcc: addr(e[7]),
    inReplyTo: e[8] as string, messageId: e[9] as string,
  };
}

const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseImapDate(s: string): Date {
  if (typeof s !== 'string') return new Date();
  const m = /(\d{1,2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? new Date() : d; }
  const tz = m[7]; const off = (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3))) * (tz[0] === '-' ? -1 : 1);
  const utc = Date.UTC(Number(m[3]), MON[m[2]] ?? 0, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - off * 60000;
  return new Date(utc);
}
const MONN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
function formatImapDate(d: Date): string {
  d = d instanceof Date ? d : new Date(d);
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-'; const a = Math.abs(off);
  return `${pad(d.getDate())}-${MONN[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}
function formatImapDateOnly(d: Date): string { return `${pad(d.getDate())}-${MONN[d.getMonth()]}-${d.getFullYear()}`; }

function decodeMime(s: string | null): string | null {
  if (typeof s !== 'string') return s;
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try {
      let bytes: Uint8Array;
      if (String(enc).toUpperCase() === 'B') { bytes = Uint8Array.from(atob(txt), (c) => c.charCodeAt(0)); }
      else { const t = txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16))); bytes = Uint8Array.from(t, (c: string) => c.charCodeAt(0)); }
      return new TextDecoder(cs).decode(bytes);
    } catch { return txt; }
  });
}
