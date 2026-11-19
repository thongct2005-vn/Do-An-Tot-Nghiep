-- Rollback cho 20261129_additive_schema_v2_rollup.sql: gỡ trigger/function v2 và 3 bảng mới; không chạm 7 bảng v1 hay dữ liệu gốc.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_transactions_dashboard_dirty_v2 ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_ins_v2 ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_upd_v2 ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_del_v2 ON public.transactions;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_ins_v2 ON public.fee_ledger_entries;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_upd_v2 ON public.fee_ledger_entries;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_del_v2 ON public.fee_ledger_entries;

DROP FUNCTION IF EXISTS public.fn_mark_fee_dirty_v2();
DROP FUNCTION IF EXISTS public.fn_mark_report_fee_dirty_v2();
DROP FUNCTION IF EXISTS public.fn_mark_report_tx_dirty_v2();
DROP FUNCTION IF EXISTS public.fn_mark_dashboard_dirty_v2();
DROP FUNCTION IF EXISTS public.fn_upsert_agg_dirty_bucket_v2(varchar, timestamptz, boolean, boolean);

DROP TABLE IF EXISTS public.aggregation_dirty_buckets;
DROP TABLE IF EXISTS public.aggregation_rollup_state;
DROP TABLE IF EXISTS public.report_merchant_financial_daily;

COMMIT;
