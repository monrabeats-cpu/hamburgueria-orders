import { createClient } from '@/lib/supabase/server';
import OrderBoard from '@/components/OrderBoard';
import { Order } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .neq('status', 'cancelled')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });

  return <OrderBoard initialOrders={(orders as Order[]) ?? []} />;
}
