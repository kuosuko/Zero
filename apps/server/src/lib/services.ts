import { env } from '../env';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

export const resend = () =>
  env.RESEND_API_KEY
    ? new Resend(env.RESEND_API_KEY)
    : { emails: { send: async (...args: unknown[]) => console.log(args) } };

// 個人自架未設 Upstash Redis (REDIS_URL 空) 時，空 url 會讓 client 打到無效 URL /pipeline → 500。
// 改回退到 in-memory shim (單人自架可接受；快取為 best-effort，session 已改用 D1)。
class InMemoryRedis {
  private store = new Map<string, { v: unknown; exp?: number }>();
  private alive(k: string) {
    const e = this.store.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) {
      this.store.delete(k);
      return undefined;
    }
    return e;
  }
  async get(k: string) {
    return (this.alive(k)?.v as unknown) ?? null;
  }
  async set(k: string, v: unknown, opts?: { ex?: number; px?: number }) {
    const exp = opts?.ex ? Date.now() + opts.ex * 1000 : opts?.px ? Date.now() + opts.px : undefined;
    this.store.set(k, { v, exp });
    return 'OK';
  }
  async del(...ks: string[]) {
    let n = 0;
    for (const k of ks) if (this.store.delete(k)) n++;
    return n;
  }
  async incr(k: string) {
    const e = this.alive(k);
    const n = (Number(e?.v) || 0) + 1;
    this.store.set(k, { v: n, exp: e?.exp });
    return n;
  }
  async expire(k: string, s: number) {
    const e = this.alive(k);
    if (e) {
      e.exp = Date.now() + s * 1000;
      return 1;
    }
    return 0;
  }
  async exists(...ks: string[]) {
    return ks.filter((k) => this.alive(k)).length;
  }
  async sadd(k: string, ...m: unknown[]) {
    const e = this.alive(k);
    const set = (e?.v as Set<unknown>) ?? new Set<unknown>();
    m.forEach((x) => set.add(x));
    this.store.set(k, { v: set, exp: e?.exp });
    return m.length;
  }
  async smembers(k: string) {
    return Array.from((this.alive(k)?.v as Set<unknown>) ?? []);
  }
  async srem(k: string, ...m: unknown[]) {
    const set = this.alive(k)?.v as Set<unknown> | undefined;
    if (!set) return 0;
    let n = 0;
    m.forEach((x) => {
      if (set.delete(x)) n++;
    });
    return n;
  }
  async mget(...ks: string[]) {
    return ks.map((k) => (this.alive(k)?.v as unknown) ?? null);
  }
  async keys() {
    return Array.from(this.store.keys());
  }
}

let _memRedis: InMemoryRedis | null = null;
export const isRedisConfigured = () => Boolean(env.REDIS_URL && env.REDIS_TOKEN);
export const redis = () =>
  isRedisConfigured()
    ? new Redis({ url: env.REDIS_URL, token: env.REDIS_TOKEN })
    : ((_memRedis ??= new InMemoryRedis()) as unknown as Redis);

export const twilio = () => {
  //   if (env.NODE_ENV === 'development' && !forceUseRealService) {
  //     return {
  //       messages: {
  //         send: async (to: string, body: string) =>
  //           console.log(`[TWILIO:MOCK] Sending message to ${to}: ${body}`),
  //       },
  //     };
  //   }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio is not configured correctly');
  }

  const send = async (to: string, body: string) => {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        },
        body: new URLSearchParams({
          To: to,
          From: env.TWILIO_PHONE_NUMBER,
          Body: body,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send OTP: ${error}`);
    }
  };

  return {
    messages: {
      send,
    },
  };
};
