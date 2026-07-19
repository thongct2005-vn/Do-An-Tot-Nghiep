const pool = require('../../config/database');
const authRepository = require('./auth.repository');
const bcrypt = require('bcrypt');
const { isValidPhone, isValidPasswordOrPin} = require('../../utils/validators');
const { uuidv7 } = require('uuidv7');
const authService = {
    isPhoneExist: async({phone})=>{
        if(!phone){
            const err = new Error("Thiếu số điện thoại");
            err.statusCode = 400;
            throw err;
        }

        if(!isValidPhone(phone)){
            const err = new Error("Số điện thoại không hợp lệ");
            err.statusCode = 400;
            throw err;
        }

        const user = await authRepository.findUserByPhone(phone);
        return{
            'is_phone_exists': user!=null
        }
    },

    login: async ({phone, password}) =>{
        if(!phone || !password){
            const err = new Error("Thiếu số điện thoại hoặc mật khẩu");
            err.statusCode = 400;
            throw err;
        }

        if(!isValidPhone(phone) || !isValidPasswordOrPin(password)){
            const err = new Error("Số điện thoại hoặc mật khẩu không hợp lệ");
            err.statusCode = 400;
            throw err;
        }

        const user = await authRepository.findUserByPhone(phone);
        if(!user){
            const err = new Error("Số điện thoại chưa đăng ký tài khoản");
            err.statusCode = 404;
            throw err;
        }

        if(user.locked_until){
            if(user.is_locked){
                const err = new Error("Tài khoản bị tạm khóa");
            err.statusCode = 403;
            throw err
            }

            await authRepository.resetFailedLogin(user.phone);
            user.failed_login_attempts = 0;
            user.locked_until = null;
        }

        const isCorrectPassword = await bcrypt.compare(password, user.password_hash);
        if(!isCorrectPassword){
            const attempts = Number(user.failed_login_attempts || 0 ) + 1;
            await authRepository.updateFailedLogin(user.phone, attempts,attempts >= 5 ? 30 : 0);
            const err = new Error(attempts >= 5 ? "Tài khoản bị tạm khóa" : "Sai mật khẩu");
            err.remainingAttempts = Math.max(5 - attempts, 0)
            err.statusCode =attempts >= 5 ? 403 : 401;
            throw err;
        }

        await authRepository.resetFailedLogin(user.phone);
        return{
            token : "đang phát triển",
            user_info:{
                user_id: user.id,
                phone: user.phone,
                email: user.email
            }
        }
    },

    register: async ({phone, password}) =>{
        if(!phone || !password){
            const err = new Error("Thiếu số điện thoại hoặc mật khẩu!");
            err.statusCode = 400;
            throw err;
        }

        if(!isValidPhone(phone) || !isValidPasswordOrPin(password)){
            const err = new Error("Số điện thoại hoặc mật khẩu không hợp lệ");
            err.statusCode = 400;
            throw err;
        }

        const user = await authRepository.findUserByPhone(phone);
        if(user){
            const err = new Error("Tài khoản đã tồn tại");
            err.statusCode = 409;
            throw err;
        }

        const userId = uuidv7();
        const walletId = uuidv7();
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        await authRepository.addUser(userId, walletId, phone, passwordHash);
        return{
            user_info:{
                user_id: userId,
                wallet_id: walletId
            }
        }
    }
}

module.exports = authService