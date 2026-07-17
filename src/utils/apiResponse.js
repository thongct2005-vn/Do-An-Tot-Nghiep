const successResponse = (res, statusCode = 200, message = 'Thành công', data = null ) =>{
    return res.status(statusCode).json(
        {
            status: "success",
            code: statusCode,
            message: message,
            data: data
        }
    );
};

const errorResponse = (res, statusCode = 500, message = 'Đã có lỗi xảy ra!', error = null ) =>{
    const result = {
        status: "error",
        code: statusCode,
        message: message,
    };

    if(error){
        result.error = error;
    }
        
    return res.status(statusCode).json( { ...result });
}

module.exports = {
    successResponse,
    errorResponse
}