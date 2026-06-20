import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';
import { redirect } from 'react-router';

// 個人自架: 首頁直接導向 — 已登入→收件匣，未登入→登入頁 (不再顯示上游 Orchid 行銷頁)。
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  if (session?.user.id) throw redirect('/mail/inbox');
  throw redirect('/login');
}

export default function Home() {
  return null;
}
