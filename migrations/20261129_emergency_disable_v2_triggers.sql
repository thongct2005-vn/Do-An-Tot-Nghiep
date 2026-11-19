-- Emergency Database Rollback for Analytics v2 Triggers ONLY.
-- Disables strictly the 7 named *_v2 dirty triggers on transactions and fee_ledger_entries.
-- NEVER disables ALL triggers, business/financial constraints, or v1 triggers.
-- Uses short lock_timeout so OLTP queries are never piled up behind DDL locks.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  v_item record;
BEGIN
  FOR v_item IN
    SELECT * FROM (VALUES
      ('transactions', 'trg_transactions_dashboard_dirty_v2'),
      ('transactions', 'trg_tx_report_dirty_ins_v2'),
      ('transactions', 'trg_tx_report_dirty_upd_v2'),
      ('transactions', 'trg_tx_report_dirty_del_v2'),
      ('fee_ledger_entries', 'trg_fee_ledger_report_dirty_ins_v2'),
      ('fee_ledger_entries', 'trg_fee_ledger_report_dirty_upd_v2'),
      ('fee_ledger_entries', 'trg_fee_ledger_report_dirty_del_v2')
    ) AS t(tbl, trg)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_trigger tr
      JOIN pg_class c ON c.oid = tr.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_item.tbl
        AND tr.tgname = v_item.trg
        AND NOT tr.tgisinternal
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', v_item.tbl, v_item.trg);
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.aggregation_rollup_state') IS NOT NULL THEN
    ALTER TABLE public.aggregation_rollup_state
      ADD COLUMN IF NOT EXISTS triggers_paused_at timestamptz;
    UPDATE public.aggregation_rollup_state
    SET triggers_paused_at = COALESCE(triggers_paused_at, NOW()),
        updated_at = NOW();
  END IF;
END
$$;

COMMIT;
