const { successResponse } = require('../../utils/apiResponse');
const authService = require('./auth.service');

const authController = {
    isPhoneExist:async(req, res, next)=>{
        try{
        const {phone} = req.body;
        const result = await authService.isPhoneExist({phone});
        return successResponse(res, 200, "Kiểm tra số điện thoại thành công", result);
        }
        catch(e){
            next(e);
        }
    },

    login: async (req, res, next)=>{
        try{
            const {phone, password} = req.body;
            const result = await authService.login({phone, password});
            return successResponse(res, 200, "Đăng nhập thành công", result);
        }
        catch(e){ next(e) }
    },

    register:async(req, res, next)=>{
        try{
            const{phone, password} = req.body;
            const result = await authService.register({phone,password});
            return successResponse(res, 200, "Tạo tài khoản thành công", result);
        }
        catch(e){ next(e) }
    }
}

module.exports = authController;