-- ============================================================
-- Hamburgueria Orders — PIX Payment Fields
-- Run this via Supabase Dashboard > SQL Editor
-- ============================================================

-- Add PIX payment columns to orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pix_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS pix_qrcode         TEXT,
  ADD COLUMN IF NOT EXISTS pix_copia_cola      TEXT,
  ADD COLUMN IF NOT EXISTS expires_at          TIMESTAMPTZ;

-- Drop old status constraint and recreate with PIX statuses
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'aguardando_pagamento',
    'pago',
    'received',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'expirado'
  ));

-- Index for fast webhook lookup by PIX transaction ID
CREATE INDEX IF NOT EXISTS idx_orders_pix_transaction
  ON public.orders (pix_transaction_id)
  WHERE pix_transaction_id IS NOT NULL;

-- Allow service role to update PIX fields (needed for webhook handler)
-- The existing "staff_update_orders" policy covers authenticated users.
-- Service role already bypasses RLS, so no new policy is needed.
