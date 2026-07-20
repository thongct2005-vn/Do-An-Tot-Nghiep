const pool = require('../../config/database');
const app = require('../../../server');
const bcrypt = require('bcrypt');
const request = require('supertest');
const {uuidv7} = require('uuidv7');

const endpointLogin = "/api/v2/auth/login";
describe(`Kiểm tra đăng nhập (${endpointLogin})`,() => {
    const phone = '0987654321';
    const password = '123456';
    beforeAll(async ()=>{
        await pool.query(`DELETE FROM users WHERE phone = $1`,[phone]);

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const userId = uuidv7();

        await pool.query(`INSERT INTO users(id, user_type, full_name, email, phone, password_hash,
             status, created_at, updated_at, failed_login_attempts, locked_until, refresh_token) 
            VALUES ($1, 'USER', 'Thong', NULL, $2, $3, 'ACTIVE', NULL, NULL, 0, NULL, NULL)`
            ,[userId, phone, password_hash]
        );
        
    });

    afterAll( async ()=>{
          await pool.query(`DELETE FROM users WHERE phone = $1`,[phone]);
          await pool.end();
    });

    test("Đăng nhập thành công", async ()=>{
        const res = await request(app)
        .post(endpointLogin)
        .send({
            phone:phone,
            password:password
        });
    
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe("success");
        expect(res.body.code).toBe(200);
        expect(res.body.message).toBe("Đăng nhập thành công");
        expect(res.body.data).toHaveProperty("token");
        expect(res.body.data).toHaveProperty("user_info");
    });

    test("Đăng nhập với số điện thoại chưa đăng ký", async ()=>{
        const res = await request(app)
        .post(endpointLogin)
        .send({
            phone:'0997654321',
            password:password
        });
    
        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe("error");
        expect(res.body.code).toBe(404);
        expect(res.body.message).toBe("Số điện thoại chưa đăng ký tài khoản");
    });

    test("Đăng nhập sai mật khẩu", async ()=>{
        const res = await request(app)
        .post(endpointLogin)
        .send({
            phone:phone,
            password:'123455'
        });
    
        expect(res.statusCode).toBe(401);
        expect(res.body.status).toBe("error");
        expect(res.body.code).toBe(401);
        expect(res.body.message).toBe("Mật khẩu không chính xác");
    });

    test ("Đăng nhập nhưng tài khoản bị tạm khóa", async()=>{
        await pool.query(`UPDATE users SET locked_until = NOW() + INTERVAL '30 minutes' WHERE phone = $1`,[phone]);

        const res = await request(app)
        .post(endpointLogin)
        .send({
            phone:phone,
            password:password
        });
    
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe("error");
        expect(res.body.code).toBe(403);
        expect(res.body.message).toBe("Tài khoản bị tạm khóa");
    })
})
