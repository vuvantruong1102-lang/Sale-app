import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/AppShell';
import QueryProvider from '@/components/QueryProvider';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <QueryProvider>
      <AppShell email={user.email}>{children}</AppShell>
    </QueryProvider>
  );
}
