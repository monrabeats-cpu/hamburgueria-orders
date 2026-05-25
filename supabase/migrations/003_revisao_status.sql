-- ============================================================
-- Hamburgueria Orders — Revisao Status + Delivery Fields
-- ============================================================

-- Add new columns for the review-first flow
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee   DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS delivery_type  TEXT
    CHECK (delivery_type IN ('entrega', 'retirada'));

-- Drop old status constraint and recreate with 'revisao'
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'revisao',
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

-- Index for fast lookup of orders pending review
CREATE INDEX IF NOT EXISTS idx_orders_revisao
  ON public.orders (status, created_at DESC)
  WHERE status = 'revisao';
