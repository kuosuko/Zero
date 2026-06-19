import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import { manualImapSmtpConnectionInputSchema } from '../../lib/schemas';
import { getActiveConnection, getZeroDB } from '../../lib/server-utils';
import { isConnectionAuthorized } from '../../lib/connection-auth';
import { validateManualImapSmtpConnection } from '../../lib/driver/imap-smtp';
import { EProviders } from '../../types';
import { Ratelimit } from '@upstash/ratelimit';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

export const connectionsRouter = router({
  list: privateProcedure
    .use(
      createRateLimiterMiddleware({
        limiter: Ratelimit.slidingWindow(120, '1m'),
        generatePrefix: ({ sessionUser }) => `ratelimit:get-connections-${sessionUser?.id}`,
      }),
    )
    .query(async ({ ctx }) => {
      const { sessionUser } = ctx;
      const db = await getZeroDB(sessionUser.id);
      const connections = await db.findManyConnections();

      const disconnectedIds = connections
        .filter((c) => !isConnectionAuthorized(c))
        .map((c) => c.id);

      return {
        connections: connections.map((connection) => {
          return {
            id: connection.id,
            email: connection.email,
            name: connection.name,
            picture: connection.picture,
            createdAt: connection.createdAt,
            providerId: connection.providerId,
          };
        }),
        disconnectedIds,
      };
    }),
  createManual: privateProcedure
    .input(manualImapSmtpConnectionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const manualConfig = {
        auth: {
          userId: ctx.sessionUser.id,
          email: input.email,
          username: input.auth.username,
          password: input.auth.password,
        },
        config: input.config,
      };

      try {
        await validateManualImapSmtpConnection(manualConfig);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to validate IMAP/SMTP connection',
        });
      }

      const db = await getZeroDB(ctx.sessionUser.id);
      const [result] = await db.createConnection(EProviders.imap_smtp, input.email, {
        expiresAt: new Date('2100-01-01T00:00:00.000Z'),
        scope: 'imap smtp',
        name: input.name ?? input.email,
        authConfig: input.auth,
        providerConfig: input.config,
      });

      return result;
    }),
  setDefault: privateProcedure
    .input(z.object({ connectionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { connectionId } = input;
      const user = ctx.sessionUser;
      const db = await getZeroDB(user.id);
      const foundConnection = await db.findUserConnection(connectionId);
      if (!foundConnection) throw new TRPCError({ code: 'NOT_FOUND' });
      await db.updateUser({ defaultConnectionId: connectionId });
    }),
  delete: privateProcedure
    .input(z.object({ connectionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { connectionId } = input;
      const user = ctx.sessionUser;
      const db = await getZeroDB(user.id);
      await db.deleteConnection(connectionId);

      const activeConnection = await getActiveConnection();
      if (connectionId === activeConnection.id) await db.updateUser({ defaultConnectionId: null });
    }),
  getDefault: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.sessionUser) return null;
    const connection = await getActiveConnection();
    return {
      id: connection.id,
      email: connection.email,
      name: connection.name,
      picture: connection.picture,
      createdAt: connection.createdAt,
      providerId: connection.providerId,
    };
  }),
});
