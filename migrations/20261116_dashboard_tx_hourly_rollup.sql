-- Additive migration for Dashboard Hybrid Rollup (dashboard_tx_hourly + dirty-hour tracking).
-- Safe to apply online; rollup_until starts at -infinity so existing readers stay on transactions until backfilled.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dashboard_tx_hourly (
  bucket_hour TIMESTAMPTZ NOT NULL,
  transaction_type TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_count BIGINT NOT NULL DEFAULT 0,
  total_amount NUMERIC(22, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_hour, transaction_type, status)
);

CREATE TABLE IF NOT EXISTS public.dashboard_rollup_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  rollup_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.dashboard_rollup_state (id, rollup_until)
VALUES (1, '-infinity'::timestamptz)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.dashboard_dirty_hours (
  bucket_hour TIMESTAMPTZ PRIMARY KEY,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.fn_mark_dashboard_dirty_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rollup_until TIMESTAMPTZ;
  v_old_hour TIMESTAMPTZ;
  v_new_hour TIMESTAMPTZ;
BEGIN
  SELECT rollup_until INTO v_rollup_until
  FROM public.dashboard_rollup_state
  WHERE id = 1;

  IF v_rollup_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.created_at < v_rollup_until THEN
    v_old_hour := date_trunc('hour', OLD.created_at);
    INSERT INTO public.dashboard_dirty_hours (bucket_hour, marked_at)
    VALUES (v_old_hour, clock_timestamp())
    ON CONFLICT (bucket_hour) DO UPDATE SET marked_at = clock_timestamp();
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.created_at < v_rollup_until THEN
    v_new_hour := date_trunc('hour', NEW.created_at);
    IF v_old_hour IS NULL OR v_new_hour <> v_old_hour THEN
      INSERT INTO public.dashboard_dirty_hours (bucket_hour, marked_at)
      VALUES (v_new_hour, clock_timestamp())
      ON CONFLICT (bucket_hour) DO UPDATE SET marked_at = clock_timestamp();
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_dashboard_dirty ON public.transactions;

CREATE TRIGGER trg_transactions_dashboard_dirty
AFTER INSERT OR UPDATE OF created_at, transaction_type, status, amount OR DELETE
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.fn_mark_dashboard_dirty_hours();

COMMIT;
