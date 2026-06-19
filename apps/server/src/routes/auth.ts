import { authProviders, customProviders, isProviderEnabled } from '../lib/auth-providers';
import { defaultUserSettings } from '../lib/schemas';
import { createDb } from '../db';
import { user, userSettings } from '../db/schema';
import type { HonoContext } from '../ctx';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

const publicRouter = new Hono<HonoContext>();
const DEV_USER_COOKIE = 'zero-dev-user';
const DEV_USER_ID = 'local-dev-user';
const DEV_USER_EMAIL = 'local-dev@zero.local';

publicRouter.get('/providers', async (c) => {
  const env = c.env as unknown as Record<string, string>;
  const isProd = env.NODE_ENV === 'production';

  const authProviderStatus = authProviders(env).map((provider) => {
    const envVarStatus =
      provider.envVarInfo?.map((envVar) => {
        const envVarName = envVar.name as keyof typeof env;
        return {
          name: envVar.name,
          set: !!env[envVarName],
          source: envVar.source,
          defaultValue: envVar.defaultValue,
        };
      }) || [];

    return {
      id: provider.id,
      name: provider.name,
      enabled: isProviderEnabled(provider, env),
      required: provider.required,
      envVarInfo: provider.envVarInfo,
      envVarStatus,
    };
  });

  const customProviderStatus = customProviders.map((provider) => {
    return {
      id: provider.id,
      name: provider.name,
      enabled: true,
      isCustom: provider.isCustom,
      customRedirectPath: provider.customRedirectPath,
      envVarStatus: [],
    };
  });

  if (!isProd) {
    customProviderStatus.unshift({
      id: 'local_dev',
      name: 'Local Dev Access',
      enabled: true,
      isCustom: true,
      customRedirectPath: '/dev/local-login',
      envVarStatus: [],
    });
  }

  const allProviders = [...customProviderStatus, ...authProviderStatus];

  return c.json({
    allProviders,
    isProd,
  });
});

publicRouter.get('/dev/local-login', async (c) => {
  if (c.env.NODE_ENV === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }

  const { db } = createDb(c.env.DB);
  const now = new Date();
  const existingUser = await db.query.user.findFirst({ where: eq(user.id, DEV_USER_ID) });

  if (!existingUser) {
    await db.insert(user).values({
      id: DEV_USER_ID,
      name: 'Local Dev User',
      email: DEV_USER_EMAIL,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
      defaultConnectionId: null,
      customPrompt: null,
      phoneNumber: null,
      phoneNumberVerified: null,
    });
  } else {
    await db.update(user).set({ updatedAt: now }).where(eq(user.id, DEV_USER_ID));
  }

  const existingSettings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, DEV_USER_ID),
  });

  if (!existingSettings) {
    await db.insert(userSettings).values({
      id: crypto.randomUUID(),
      userId: DEV_USER_ID,
      settings: defaultUserSettings,
      createdAt: now,
      updatedAt: now,
    });
  }

  setCookie(c, DEV_USER_COOKIE, DEV_USER_ID, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: false,
    maxAge: 60 * 60 * 24 * 30,
  });

  const redirectTo = c.req.query('redirectTo') || '/settings/connections';
  return c.redirect(redirectTo);
});

publicRouter.get('/dev/session', async (c) => {
  if (c.env.NODE_ENV === 'production') {
    return c.json({ session: null }, 404);
  }

  const devUserId = getCookie(c, DEV_USER_COOKIE);
  if (!devUserId) {
    return c.json({ session: null });
  }

  const { db } = createDb(c.env.DB);
  const devUser = await db.query.user.findFirst({ where: eq(user.id, devUserId) });

  if (!devUser) {
    return c.json({ session: null });
  }

  return c.json({
    session: {
      user: devUser,
      session: {
        id: 'local-dev-session',
        userId: devUser.id,
        token: 'local-dev-session',
        expiresAt: null,
        ipAddress: null,
        userAgent: 'local-dev',
        createdAt: null,
        updatedAt: null,
      },
    },
  });
});

publicRouter.get('/dev/logout', async (c) => {
  deleteCookie(c, DEV_USER_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

export { publicRouter };
