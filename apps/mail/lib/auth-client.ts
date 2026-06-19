import { phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { Auth } from '@zero/server/auth';
import { useCallback, useEffect, useState } from 'react';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_PUBLIC_BACKEND_URL,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [phoneNumberClient()],
});

const rawSignOut = authClient.signOut;
const rawUseSession = authClient.useSession;

export type Session = Awaited<ReturnType<Auth['api']['getSession']>>;

async function fetchDevSession() {
  try {
    const response = await fetch(import.meta.env.VITE_PUBLIC_BACKEND_URL + '/api/public/dev/session', {
      credentials: 'include',
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { session: Session | null };
    return payload.session;
  } catch {
    return null;
  }
}

export const useSession = () => {
  const session = rawUseSession();
  const [devSession, setDevSession] = useState<Session | null>(null);
  const [devPending, setDevPending] = useState(false);

  const refreshDevSession = useCallback(async () => {
    setDevPending(true);
    try {
      const fallbackSession = await fetchDevSession();
      setDevSession(fallbackSession);
      return fallbackSession;
    } finally {
      setDevPending(false);
    }
  }, []);

  useEffect(() => {
    if (session.data) {
      setDevSession(null);
      return;
    }

    if (!session.isPending) {
      void refreshDevSession();
    }
  }, [refreshDevSession, session.data, session.isPending]);

  return {
    ...session,
    data: session.data ?? devSession,
    isPending: session.isPending || (!session.data && devPending),
    refetch: async () => {
      const result = await session.refetch();
      if (!result.data) {
        await refreshDevSession();
      }
      return result;
    },
  };
};

export const signOut = async (...args: Parameters<typeof rawSignOut>) => {
  const result = await rawSignOut(...args);

  try {
    await fetch(import.meta.env.VITE_PUBLIC_BACKEND_URL + '/api/public/dev/logout', {
      credentials: 'include',
    });
  } catch {
    // Ignore dev logout cleanup failures in non-dev environments.
  }

  return result;
};

export const { signIn, signUp, getSession, $fetch } = authClient;
