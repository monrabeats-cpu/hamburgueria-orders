'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface HeaderProps {
  userEmail: string;
}

export default function Header({ userEmail }: HeaderProps) {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-[1700px] mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">H</span>
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm leading-tight">Painel de Pedidos</p>
            <p className="text-xs text-slate-500 leading-tight">Hamburgueria</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500 hidden sm:block">{userEmail}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
