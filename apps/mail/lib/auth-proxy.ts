import { createAuthClient } from 'better-auth/client';

const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_PUBLIC_BACKEND_URL,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [],
});

export const authProxy = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const session = await authClient.getSession({
        fetchOptions: { headers, credentials: 'include' },
      });
      if (!session.error && session.data) {
        return session.data;
      }

      try {
        const response = await fetch(import.meta.env.VITE_PUBLIC_BACKEND_URL + '/api/public/dev/session', {
          credentials: 'include',
          headers,
        });
        if (!response.ok) return null;
        const payload = (await response.json()) as { session: unknown | null };
        return payload.session;
      } catch {
        if (session.error) {
          console.error(`Failed to get session: ${session.error}`, session);
        }
        return null;
      }
    },
  },
};
