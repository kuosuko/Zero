import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { emailProviders } from '@/lib/constants';
import { authClient } from '@/lib/auth-client';
import { useTRPC } from '@/providers/query-provider';
import { ArrowLeft, Loader2, Mail, Plus, UserPlus } from 'lucide-react';
import { useLocation } from 'react-router';
import { m } from '@/paraglide/messages';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const initialManualForm = {
  email: '',
  name: '',
  username: '',
  password: '',
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  smtpHost: '',
  smtpPort: '465',
  smtpSecure: true,
};

export const AddConnectionDialog = ({
  children,
  className,
  onOpenChange,
}: {
  children?: React.ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState(initialManualForm);

  const pathname = useLocation().pathname;

  const { mutateAsync: createManual, isPending: isCreatingManual } = useMutation(
    trpc.connections.createManual.mutationOptions(),
  );
  const { mutateAsync: setDefaultConnection } = useMutation(
    trpc.connections.setDefault.mutationOptions(),
  );

  const resetManualForm = () => {
    setShowManualForm(false);
    setManualForm(initialManualForm);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetManualForm();
    }
    onOpenChange?.(nextOpen);
  };

  const updateManualField = (field: keyof typeof initialManualForm, value: string | boolean) => {
    setManualForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateManual = async () => {
    try {
      const result = await createManual({
        email: manualForm.email.trim(),
        name: manualForm.name.trim() || undefined,
        auth: {
          username: manualForm.username.trim(),
          password: manualForm.password,
        },
        config: {
          imap: {
            host: manualForm.imapHost.trim(),
            port: Number(manualForm.imapPort),
            secure: manualForm.imapSecure,
          },
          smtp: {
            host: manualForm.smtpHost.trim(),
            port: Number(manualForm.smtpPort),
            secure: manualForm.smtpSecure,
          },
        },
      });

      await setDefaultConnection({ connectionId: result.id });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.connections.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.connections.getDefault.queryKey() }),
      ]);

      toast.success('Manual IMAP/SMTP account connected');
      handleDialogOpenChange(false);
      window.location.href = '/mail';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create IMAP/SMTP connection');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button
            size={'dropdownItem'}
            variant={'dropdownItem'}
            className={cn('w-full justify-start gap-2', className)}
          >
            <UserPlus size={16} strokeWidth={2} className="opacity-60" aria-hidden="true" />
            <p className="text-[13px] opacity-60">{m['pages.settings.connections.addEmail']()}</p>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showOverlay={true}>
        <DialogHeader>
          <DialogTitle>{m['pages.settings.connections.connectEmail']()}</DialogTitle>
          <DialogDescription>
            {m['pages.settings.connections.connectEmailDescription']()}
          </DialogDescription>
        </DialogHeader>
        {showManualForm ? (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setShowManualForm(false)}>
                <ArrowLeft className="mr-2 size-4" />
                Back
              </Button>
              <div className="text-muted-foreground text-xs">Credentials stay local to this connection.</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="manual-email">Email address</Label>
                <Input
                  id="manual-email"
                  type="email"
                  value={manualForm.email}
                  onChange={(e) => updateManualField('email', e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="manual-name">Display name</Label>
                <Input
                  id="manual-name"
                  value={manualForm.name}
                  onChange={(e) => updateManualField('name', e.target.value)}
                  placeholder="Personal mailbox"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-username">Login username</Label>
                <Input
                  id="manual-username"
                  value={manualForm.username}
                  onChange={(e) => updateManualField('username', e.target.value)}
                  placeholder="IMAP/SMTP username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-password">Password / app password</Label>
                <Input
                  id="manual-password"
                  type="password"
                  value={manualForm.password}
                  onChange={(e) => updateManualField('password', e.target.value)}
                  placeholder="Password"
                />
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Mail className="size-4" />
                IMAP server
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="imap-host">Host</Label>
                  <Input
                    id="imap-host"
                    value={manualForm.imapHost}
                    onChange={(e) => updateManualField('imapHost', e.target.value)}
                    placeholder="imap.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="imap-port">Port</Label>
                  <Input
                    id="imap-port"
                    type="number"
                    value={manualForm.imapPort}
                    onChange={(e) => updateManualField('imapPort', e.target.value)}
                  />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={manualForm.imapSecure}
                  onChange={(e) => updateManualField('imapSecure', e.target.checked)}
                />
                Use TLS / SSL
              </label>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Mail className="size-4" />
                SMTP server
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="smtp-host">Host</Label>
                  <Input
                    id="smtp-host"
                    value={manualForm.smtpHost}
                    onChange={(e) => updateManualField('smtpHost', e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp-port">Port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    value={manualForm.smtpPort}
                    onChange={(e) => updateManualField('smtpPort', e.target.value)}
                  />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={manualForm.smtpSecure}
                  onChange={(e) => updateManualField('smtpSecure', e.target.checked)}
                />
                Use TLS / SSL
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={isCreatingManual} onClick={handleCreateManual}>
                {isCreatingManual ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Validate and connect
              </Button>
            </div>
          </div>
        ) : (
          <motion.div
            className="mt-4 grid grid-cols-2 gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {emailProviders.map((provider, index) => {
              const Icon = provider.icon;
              const isManualProvider = provider.providerId === 'imap_smtp';
              return (
                <motion.div
                  key={provider.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1, duration: 0.3 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Button
                    variant="outline"
                    className="h-24 w-full flex-col items-center justify-center gap-2"
                    onClick={async () => {
                      if (isManualProvider) {
                        setShowManualForm(true);
                        return;
                      }

                      await authClient.linkSocial({
                        provider: provider.providerId,
                        callbackURL: `${window.location.origin}${pathname}`,
                      });
                    }}
                  >
                    <Icon className="size-6!" />
                    <span className="text-center text-xs">{provider.name}</span>
                  </Button>
                </motion.div>
              );
            })}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: emailProviders.length * 0.1, duration: 0.3 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Button
                variant="outline"
                className="h-24 w-full flex-col items-center justify-center gap-2 border-dashed"
              >
                <Plus className="h-12 w-12" />
                <span className="text-xs">{m['pages.settings.connections.moreComingSoon']()}</span>
              </Button>
            </motion.div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
};
