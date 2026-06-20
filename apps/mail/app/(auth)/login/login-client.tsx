import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import ErrorMessage from '@/app/(auth)/login/error-message';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signIn } from '@/lib/auth-client';
import { useNavigate } from 'react-router';
import { useQueryState } from 'nuqs';
import { toast } from 'sonner';

interface LoginClientProps {
  providers?: unknown;
  isProd?: boolean;
}

function LoginClientContent(_props: LoginClientProps) {
  const navigate = useNavigate();
  const [error] = useQueryState('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await signIn.email({ email, password, callbackURL: '/mail/inbox' });
      if (res?.error) {
        toast.error(res.error.message || 'Login failed');
      } else {
        navigate('/mail/inbox');
      }
    } catch {
      toast.error('Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-between bg-[#111111]">
      <div className="animate-in slide-in-from-bottom-4 mx-auto flex max-w-[600px] grow items-center justify-center space-y-8 px-4 duration-500 sm:px-12 md:px-0">
        <div className="w-full space-y-4">
          <p className="text-center text-4xl font-bold text-white md:text-5xl">Sign in</p>

          <form onSubmit={handleEmailLogin} className="space-y-3">
            <Input
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11 bg-white/5 text-white placeholder:text-white/40"
            />
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 bg-white/5 text-white placeholder:text-white/40"
            />
            <Button type="submit" disabled={submitting} className="h-11 w-full">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {error && (
            <Alert variant="default" className="border-orange-500/40 bg-orange-500/10">
              <AlertTitle className="text-orange-400">Error</AlertTitle>
              <AlertDescription>Failed to log you in. Please try again.</AlertDescription>
            </Alert>
          )}

          <ErrorMessage />
        </div>
      </div>
      <a href={'/'} className="text-white hover:text-gray-200">
        Return home
      </a>

      <footer className="w-full px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-6">
          <a
            href="/terms"
            className="text-[10px] text-gray-400 hover:text-gray-200 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Terms of Service
          </a>
          <a
            href="/privacy"
            className="text-[10px] text-gray-400 hover:text-gray-200 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
}

export function LoginClient(props: LoginClientProps) {
  const fallback = (
    <div className="flex min-h-screen w-full items-center justify-center">
      <p>Loading...</p>
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      <LoginClientContent {...props} />
    </Suspense>
  );
}
