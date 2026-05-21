import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Hamburgueria | Painel de Pedidos',
  description: 'Gerenciamento de pedidos via WhatsApp em tempo real',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${geist.className} bg-slate-50 min-h-screen`}>{children}</body>
    </html>
  );
}
