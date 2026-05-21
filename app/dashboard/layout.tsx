import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Header from '@/components/Header';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-slate-50">
      <Header userEmail={user.email!} />
      <main className="max-w-[1700px] mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
