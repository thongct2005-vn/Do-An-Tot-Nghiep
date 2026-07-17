const { successResponse } = require('../../utils/apiResponse');
const authService = require('./auth.service');

const authController = {
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