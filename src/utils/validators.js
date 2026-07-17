const isValidPhone = (phone)=>{
    if(!phone) return false;
    const phoneRegex = /^(03||05||07||08||09)\d{8}$/;
    return phoneRegex.test(phone);
}

const isValidPasswordOrPin = (passworrd)=>{
    if(!passworrd) return false;
    const passwordRegex = /^\d{6}$/;
    return passwordRegex.test(passworrd);
}

module.exports = {
    isValidPhone,
    isValidPasswordOrPin
}