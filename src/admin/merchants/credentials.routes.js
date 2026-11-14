const router = require('express').Router({mergeParams:true});
const pool = require('../../config/database');
const credentials = require('../../modules/merchant/shared/credentials');
const { httpError } = require('../../utils/httpError');
const { successResponse } = require('../../utils/apiResponse');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = ['ISSUED','ROTATED','REVOKED','REISSUED'].map(x=>`MERCHANT_CREDENTIALS_${x}`);
router.use((req,res,next)=>{res.set('Cache-Control','no-store'); if (!UUID.test(req.params.id)) return next(httpError(400,'Định danh Merchant không hợp lệ')); next();});
router.get('/',async(req,res,next)=>{
  try {
    const row=(await pool.query("SELECT id,api_key,secret_key,credentials_revoked,credentials_revision FROM users WHERE id=$1 AND role='MERCHANT'",[req.params.id])).rows[0];
    if(!row) throw httpError(404,'Không tìm thấy Merchant');
    successResponse(res,200,'Thông tin credentials',credentials.metadata(row));
  }catch(e){next(e);}
});
for (const operation of ['issue','rotate','revoke','reissue']) router.post(`/${operation}`,async(req,res,next)=>{
  try {
    const body = Object.hasOwn(req,'rawBodyForRisk') ? req.rawBodyForRisk : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!['reason','expected_revision'].includes(k))) throw httpError(400,'Dữ liệu không hợp lệ');
    if (typeof body.reason !== 'string' || body.reason.trim().length<5 || body.reason.trim().length>500) throw httpError(400,'Lý do phải từ 5 đến 500 ký tự');
    if (!/^(0|[1-9][0-9]{0,17})$/.test(String(body.expected_revision ?? ''))) throw httpError(400,'Thiếu hoặc sai expected_revision');
    const result=await credentials.mutate({merchantId:req.params.id,operation,expectedRevision:body.expected_revision,adminId:req.user.user_id,reason:body.reason.trim()});
    successResponse(res,200,'Cập nhật credentials thành công',result);
  }catch(e){next(e);}
});

async function history(req,res,next) {
  try {
    if(!UUID.test(req.params.id)) throw httpError(400,'Định danh Merchant không hợp lệ');
    const exists=await pool.query("SELECT 1 FROM users WHERE id=$1 AND role='MERCHANT'",[req.params.id]);
    if(!exists.rowCount) throw httpError(404,'Không tìm thấy Merchant');
    const page=String(req.query.page ?? '1'),limit=String(req.query.limit ?? '10');
    if(!/^[1-9][0-9]{0,6}$/.test(page)|| !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit)>100) throw httpError(400,'Phân trang không hợp lệ');
    const action=req.query.action ?? null;
    if(action!==null && !actions.includes(action)) throw httpError(400,'Action không hợp lệ');
    const params=[req.params.id,actions,action];
    const where='h.user_id=$1 AND h.action=ANY($2::text[]) AND ($3::text IS NULL OR h.action=$3)';
    const total=Number((await pool.query(`SELECT count(*) FROM admin_user_change_history h WHERE ${where}`,params)).rows[0].count);
    const rows=(await pool.query(`SELECT h.id,h.action,h.reason,h.created_at,h.admin_id,u.full_name AS admin_name,
      jsonb_build_object('state',h.old_values->>'state','revision',h.old_values->>'revision','api_key_masked',h.old_values->>'api_key_masked') AS old_values,
      jsonb_build_object('state',h.new_values->>'state','revision',h.new_values->>'revision','api_key_masked',h.new_values->>'api_key_masked','cancelled_payments',h.new_values->'cancelled_payments') AS new_values
      FROM admin_user_change_history h LEFT JOIN users u ON u.id=h.admin_id WHERE ${where}
      ORDER BY h.created_at DESC,h.id DESC LIMIT $4 OFFSET $5`,[...params,Number(limit),(Number(page)-1)*Number(limit)])).rows;
    res.set('Cache-Control','no-store');
    successResponse(res,200,'Lịch sử credentials',{items:rows,pagination:{total_items:total,current_page:Number(page),limit:Number(limit),total_pages:Math.ceil(total/Number(limit))}});
  }catch(e){next(e);}
}
module.exports={router,history};
