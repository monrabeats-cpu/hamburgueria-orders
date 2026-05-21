-- ============================================================
-- Hamburgueria Orders — Initial Schema
-- Run this via Supabase Dashboard > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.orders (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp_number TEXT          NOT NULL,
  customer_name   TEXT,
  items           JSONB         NOT NULL DEFAULT '[]',
  total           DECIMAL(10,2),
  status          TEXT          NOT NULL DEFAULT 'received'
                  CHECK (status IN (
                    'received', 'confirmed', 'preparing',
                    'ready', 'out_for_delivery', 'delivered', 'cancelled'
                  )),
  notes           TEXT,
  address         TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id        UUID          REFERENCES public.orders (id) ON DELETE CASCADE,
  whatsapp_number TEXT          NOT NULL,
  direction       TEXT          NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content         TEXT          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on orders
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_updated_at ON public.orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_whatsapp ON public.orders (whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_order  ON public.messages (order_id);

-- Row-Level Security
ALTER TABLE public.orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Authenticated staff can read and update orders
CREATE POLICY "staff_select_orders"
  ON public.orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "staff_update_orders"
  ON public.orders FOR UPDATE TO authenticated USING (true);

-- Webhook uses service role to insert
CREATE POLICY "service_insert_orders"
  ON public.orders FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "staff_select_messages"
  ON public.messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_all_messages"
  ON public.messages FOR ALL TO service_role USING (true);

-- Enable Realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
