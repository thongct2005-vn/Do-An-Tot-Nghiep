const authRepository = require('./auth.repository');
const bcrypt = require('bcrypt');

const authService = {
    login: async ({phone, password})=>{
        if(!phone || !password){
            const err = new Error("Thiếu số điện thoại hoặc mật khẩu");
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
            if(new Date(user.locked_until) > new Date()){
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
            const err = new Error(attempts >= 5 ? "Tài khoản của bạn đã bị tạm khóa" : "Sai mật khẩu");
            err.remainingAttempts = Math.max(5 - attempts, 0)
            err.statusCode = 401;
            throw err;
        }

        await authRepository.resetFailedLogin(user.phone);
        return{
            token : "đang phát triển",
            user_info:{
                id: user.id,
                phone: user.phone,
                email: user.email
            }
        }
    }
}

module.exports = authService