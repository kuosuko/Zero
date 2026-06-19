import { useEffect } from 'react';

export default function LocalDevLoginPage() {
  useEffect(() => {
    const redirectTo = `${window.location.origin}/settings/connections`;
    const url =
      `${import.meta.env.VITE_PUBLIC_BACKEND_URL}/api/public/dev/local-login?redirectTo=` +
      encodeURIComponent(redirectTo);

    window.location.href = url;
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="space-y-3 text-center">
        <p className="text-lg font-medium">Preparing local dev session…</p>
        <p className="text-sm text-white/60">If you are not redirected automatically, refresh this page.</p>
      </div>
    </div>
  );
}
