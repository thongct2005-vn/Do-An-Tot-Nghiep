const twilio = require('twilio');
require('dotenv').config();
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

const client = twilio(accountSid, authToken);

const formatPhoneNumber = (phone) =>{
    let p = String(phone).trim();
    if(p.startsWith('0')) return '+84' + p.slice(1);
    return p;
}

const sendOtp = async(phoneNumber) =>{
    try{
        const formattedPhone = formatPhoneNumber(phoneNumber);
        console.log(formattedPhone);
        const verification = await client.verify.v2
        .services(verifyServiceSid)
        .verifications.create({
            to: formattedPhone,
            channel: 'sms'
        });

        return{
            success: true,
            status: verification.status,
            message: 'OTP đã được gửi thành công'
        }
    }
    catch(e){
        const err = new Error(e);
        err.statusCode = 500;
        throw err;
    }
}

const verifyOtp = async(phoneNumber, code)=>{
    try{
        const formattedPhone = formatPhoneNumber(phoneNumber);
        const verification = await client.verify.v2
        .services(verifyServiceSid)
        .verificationChecks.create({
            to: formattedPhone,
            code: code
        });
        return{
            success: true,
            status: verification.status,
            valid: verification.valid
        }
    }
    catch(e){
        console.log(e);
        const err = new Error(e);
        err.statusCode = 500;
        throw err;
    }
}

module.exports = {
    sendOtp,
    verifyOtp
}
