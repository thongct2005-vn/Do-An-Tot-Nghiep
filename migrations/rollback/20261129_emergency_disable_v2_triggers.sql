-- Re-enable ONLY the 7 Analytics v2 triggers on transactions and fee_ledger_entries.
-- IMPORTANT: Do NOT set ANALYTICS_STORAGE_MODE=v2 until emergency_v2_triggers.js --enable-and-reconcile
-- finishes gap backfill & parity verification after triggers are re-enabled.
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
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', v_item.tbl, v_item.trg);
    END IF;
  END LOOP;
END
$$;

COMMIT;
