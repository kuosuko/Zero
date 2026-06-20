import { privateProcedure, router } from '../trpc';
import jwt from '@tsndr/cloudflare-worker-jwt';

export const userRouter = router({
  delete: privateProcedure.mutation(async ({ ctx }) => {
    const { success, message } = await ctx.c.var.auth.api.deleteUser({
      body: {
        callbackURL: '/',
      },
      headers: ctx.c.req.raw.headers,
      request: ctx.c.req.raw,
    });
    return { success, message };
  }),
  getIntercomToken: privateProcedure.query(async ({ ctx }) => {
    // Intercom 未設定 (無 JWT_SECRET) → 不簽 token，回 null (避免 "secret must be a string" 500)。
    if (!ctx.c.env.JWT_SECRET) return null;
    const token = await jwt.sign(
      {
        user_id: ctx.sessionUser.id,
        email: ctx.sessionUser.email,
      },
      ctx.c.env.JWT_SECRET,
    );
    return token;
  }),
});
