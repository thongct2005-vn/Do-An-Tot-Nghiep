const { Server } = require('socket.io');
const tokenUtil = require('./jwt');
let io;
const initSocket = (server) => {
    io = new Server(server, {
        cors:{
            origin:'*',
            methods: ["GET", "POST"]
        }
    });

    io.use((socket, next)=>{
        const token = socket.handshake.auth.token;
        if(!token){
            const err = new Error("Thiếu thông tin xác thực để kết nối");
            err.statusCode = 401;
            next(err);
        }

        try{
            const decode = tokenUtil.verifyAccessToken(token);
            socket.user = decode;
            next();
        }
        catch(e){
            const err = new Error("Thông tin xác thực không hợp lệ hoặc đã hết hạn");
            err.statusCode = 401;
            next(err);
        }
    });

    io.on('connection', (socket)=>{
        const userId = socket.user.id;
        console.log(`${userId} đã kết nối socket thành công - Socket ID: ${socket.id}`);
        socket.join(`user_${userId}`);
        socket.on('disconnect', ()=>{
            console.log(`${userId} đã ngắt kết nối`);
        })
    })
    return io;
};

const emitToUser = (userId, eventName, data)=>{
    if(io){
        io.to(`user_${userId}`).emit(eventName, data);
    }
};

module.exports = {
    initSocket,
    emitToUser
}