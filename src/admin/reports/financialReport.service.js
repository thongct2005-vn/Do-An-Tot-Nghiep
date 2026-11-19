const { Pool } = require('pg');
const defaultPool = require('../../config/database');
const { readFinancialData } = require('./financialReport.repository');
const { exactInteger, previousRange, percentChange } = require('./financialReport.data');
const {
  isMissingRelationError,
  getReportRollupState,
  ensureReportRollupConsistent,
  queryGrowthVolume,
} = require('./reportRollup');
const {
  getRollupState: getDashboardRollupState,
  ensureRollupConsistent: ensureDashboardRollupConsistent,
} = require('../dashboard/dashboardRollup');

async function readSnapshotRollupState(client) {
  const { rows: reg } = await client.query(`
    SELECT
      (to_regclass('public.report_rollup_state') IS NOT NULL
        AND to_regclass('public.report_dirty_hours') IS NOT NULL
        AND to_regclass('public.report_merchant_fee_hourly') IS NOT NULL
        AND to_regclass('public.report_merchant_tx_hourly') IS NOT NULL
        AND to_regclass('public.report_gateway_hourly') IS NOT NULL) AS has_report_rollup,
      (to_regclass('public.dashboard_rollup_state') IS NOT NULL
        AND to_regclass('public.dashboard_dirty_hours') IS NOT NULL
        AND to_regclass('public.dashboard_tx_hourly') IS NOT NULL) AS has_dash_rollup
  `);
  const flags = reg[0] || {};
  let rollupUntil = null;
  let dashRollupUntil = null;
  if (flags.has_report_rollup) {
    const reportState = await getReportRollupState(client);
    if (reportState.isFinite && !reportState.hasDirty) {
      rollupUntil = reportState.rollupUntil;
    }
  }
  if (flags.has_dash_rollup) {
    const dashState = await getDashboardRollupState(client);
    if (dashState.isFinite && !dashState.hasDirty) {
      dashRollupUntil = dashState.rollupUntil;
    }
  }
  return { rollupUntil, dashRollupUntil };
}

async function readSnapshot(pool, filters, adminId) {
  if (pool === defaultPool || pool instanceof Pool) {
    await ensureReportRollupConsistent(pool).catch(() => null);
    await ensureDashboardRollupConsistent(pool).catch(() => null);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: metadata } = await client.query('SELECT clock_timestamp() AS snapshot_at, full_name AS admin_name FROM users WHERE id=$1', [adminId]);
    if (!metadata.length) throw new Error('Không tìm thấy người xuất báo cáo');
    const { rollupUntil, dashRollupUntil } = await readSnapshotRollupState(client);
    const data = await readFinancialData(client, filters, { rollupUntil, dashRollupUntil });
    const previous = previousRange(filters);
    const { rows: accounts } = await client.query(`SELECT role,
      count(*) FILTER (WHERE created_at >= $1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh') AS current,
      count(*) FILTER (WHERE created_at >= $3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh'
        AND created_at < $1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh') AS previous,
      count(*) AS total FROM users
      WHERE role IN ('USER','MERCHANT') AND ($4='ALL' OR role=$4)
        AND created_at < $2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh' GROUP BY role`,
    [filters.startInstant, filters.nextDayInstant, previous.startInstant, filters.role || 'ALL']);
    let txVolume;
    try {
      txVolume = await queryGrowthVolume(client, filters, previous.startInstant, dashRollupUntil);
    } catch (err) {
      if (dashRollupUntil && isMissingRelationError(err)) {
        txVolume = await queryGrowthVolume(client, filters, previous.startInstant, null);
      } else {
        throw err;
      }
    }
    data.growth = {
      accounts: (filters.role && filters.role !== 'ALL' ? [filters.role] : ['USER','MERCHANT']).map(role => {
        const row=accounts.find(r=>r.role===role) || { current:0, previous:0, total:0 };
        const current=exactInteger(row.current), prev=exactInteger(row.previous);
        return { role, current, previous:prev, total:exactInteger(row.total), growth:percentChange(current,prev) };
      }),
      transactions: Object.fromEntries(Object.entries(txVolume).map(([k,v])=>[k,exactInteger(v)])),
    };
    data.metadata = { admin_id:adminId, admin_name:metadata[0].admin_name, financial_snapshot_at:metadata[0].snapshot_at };
    data.period=filters.period;
    data.filters={ merchant_id:filters.merchant, transaction_type:filters.type || 'ALL', role:filters.role || 'ALL' };
    data.previous_period={ start:previous.startInstant, end_exclusive:previous.nextDayInstant };
    await client.query('COMMIT');
    return data;
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}

async function attachLogins(data, input, readLogins) {
  const startedAt=new Date();
  try {
    const result=await readLogins({ start_date:input.start_date, end_date:input.end_date });
    data.logins={ available:true, summary:{total_logins:exactInteger(result.summary.total_logins),unique_users:exactInteger(result.summary.unique_users)}, read_started_at:startedAt, read_completed_at:new Date() };
  } catch (_) {
    data.logins={ available:false, read_started_at:startedAt, read_completed_at:new Date(), message:'Dữ liệu đăng nhập tạm thời không khả dụng' };
  }
  return data;
}
async function exportFinancialReport(input, adminId, { pool = require('../../config/database'), readLogins, renderer } = {}) {
  const reports=require('./reports.service');
  const filters=reports.filters(input);
  const data=await readSnapshot(pool,filters,adminId);
  await attachLogins(data,data.period,readLogins || reports.logins);
  data.metadata.report_id=require('uuidv7').uuidv7();
  data.metadata.generated_at=new Date().toISOString();
  data.reconciliation=require('./financialReport.reconciliation').reconcile(data);
  const book=await (renderer || require('./financialReport.export').buildWorkbook)(data);
  const buffer=await book.xlsx.writeBuffer();
  await pool.query('INSERT INTO audit_outbox(id,event_type,payload) VALUES($1,$2,$3::jsonb)',[
    data.metadata.report_id,'ADMIN_FINANCIAL_REPORT_GENERATED',JSON.stringify({
      report_id:data.metadata.report_id,admin_id:adminId,period:data.period,filters:data.filters,
      financial_snapshot_at:data.metadata.financial_snapshot_at,generated_at:data.metadata.generated_at,
      workbook_version:1,merchant_rows:data.merchant.merchants.length,logins_available:data.logins.available,
      reconciliation:data.reconciliation.map(({name,status,difference})=>({name,status,difference})),
    }),
  ]);
  const fileName=`Bao_cao_tai_chinh_vi_dien_tu_${data.period.start_date.replaceAll('-','')}_${data.period.end_date.replaceAll('-','')}.xlsx`;
  return {buffer,fileName,reportId:data.metadata.report_id};
}
module.exports = { readSnapshot, attachLogins, exportFinancialReport };
