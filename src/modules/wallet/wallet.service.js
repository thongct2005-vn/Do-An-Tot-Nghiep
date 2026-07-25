const walletRepository = require('./wallet.repository');
const walletService = {
    async getWalletBalanceByUserId(userId){
        if(!userId){
            const err = new Error('Thiếu userId để lấy số dư');
            err.statusCode = 400;
            throw err;
        }
        const wallet = await walletRepository.getWalletBalanceByUserId(userId);
        if(!wallet){
            const err = new Error('Không tìm thấy ví của người dùng');
            err.statusCode = 404;
            throw err;
        }
        return {
            balance: wallet.balance
        }
    }
}

module.exports = walletService;