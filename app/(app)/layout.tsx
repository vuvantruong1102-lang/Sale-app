import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar email={user.email} />
      <main className="ml-60 flex-1 p-7 max-w-[1600px]">
        {children}
      </main>
    </div>
  );
}
