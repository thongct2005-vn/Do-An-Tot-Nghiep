--
-- PostgreSQL database dump
--

\restrict er2bjdaPcTIQwBnttLjIndIfdm0nDZgHJPCIsgICUxcxTktcQuu2AXAChoFeVgs

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

-- Started on 2026-10-18 10:58:26

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16544)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 5044 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 891 (class 1247 OID 16386)
-- Name: transaction_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.transaction_type_enum AS ENUM (
    'TRANSFER',
    'TOPUP',
    'WITHDRAW',
    'PAYMENT',
    'REFUND',
    'REVERSAL'
);


ALTER TYPE public.transaction_type_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 218 (class 1259 OID 16399)
-- Name: banks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.banks (
    id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    logo_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.banks OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16406)
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.idempotency_keys (
    idempotency_key character varying(100) NOT NULL,
    actor_id uuid,
    actor_type character varying(20),
    request_path character varying(50),
    status character varying(20) DEFAULT 'pending'::character varying,
    response_body json,
    request_hash text,
    create_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    response_status_code integer
);


ALTER TABLE public.idempotency_keys OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16414)
-- Name: linked_bank_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.linked_bank_accounts (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    bank_id uuid NOT NULL,
    account_number character varying(30) NOT NULL,
    account_holder_name character varying(100) NOT NULL,
    balance bigint DEFAULT 10000000 NOT NULL,
    is_default boolean DEFAULT false,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_linked_bank_accounts_balance CHECK ((balance >= 0))
);


ALTER TABLE public.linked_bank_accounts OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16423)
-- Name: otp_tracking; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.otp_tracking (
    id uuid NOT NULL,
    email character varying(100) DEFAULT NULL::character varying,
    otp_hash text NOT NULL,
    failed_attempts integer DEFAULT 0,
    locked_until timestamp with time zone,
    expired_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval),
    used_at timestamp with time zone,
    created_at timestamp with time zone,
    phone character varying(20)
);


ALTER TABLE public.otp_tracking OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16431)
-- Name: payment_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_requests (
    id uuid NOT NULL,
    reference_code character varying(50) NOT NULL,
    destination_user_id uuid NOT NULL,
    source_user_id uuid,
    transaction_id character varying(100),
    amount bigint NOT NULL,
    description text,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval),
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.payment_requests OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16440)
-- Name: transaction_ref_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transaction_ref_seq
    START WITH 100000000000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transaction_ref_seq OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16441)
-- Name: transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transactions (
    id character varying(100) DEFAULT (nextval('public.transaction_ref_seq'::regclass))::character varying NOT NULL,
    transaction_type public.transaction_type_enum NOT NULL,
    source_user_id uuid,
    source_balance_before bigint,
    source_balance_after bigint,
    destination_user_id uuid,
    dest_balance_before bigint,
    dest_balance_after bigint,
    amount bigint NOT NULL,
    fee bigint DEFAULT 0 NOT NULL,
    status character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    description text,
    idempotency_key character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp with time zone DEFAULT now(),
    linked_bank_account_id uuid,
    CONSTRAINT transactions_amount_check CHECK ((amount > 0))
);


ALTER TABLE public.transactions OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16452)
-- Name: user_kyc; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_kyc (
    id character varying(50) NOT NULL,
    user_id uuid NOT NULL,
    dob character varying(20),
    gender character varying(10),
    address text,
    front_image_url text,
    back_image_url text,
    status character varying(20),
    face_match_score numeric,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    face_image_url text
);


ALTER TABLE public.user_kyc OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16459)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    role character varying(20) DEFAULT 'USER'::character varying,
    full_name character varying(50) DEFAULT NULL::character varying,
    email character varying(100) DEFAULT NULL::character varying,
    phone character varying(10) NOT NULL,
    password_hash text,
    status character varying(10) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    failed_login_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    refresh_token text,
    pin_hash text,
    phone_hash text,
    fcm_token text,
    static_qr_token character varying(100),
    balance bigint DEFAULT 0 NOT NULL,
    api_key text,
    call_back_url text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 5030 (class 0 OID 16399)
-- Dependencies: 218
-- Data for Name: banks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.banks (id, code, name, logo_url, is_active, created_at) FROM stdin;
019fdc5a-a65d-75b4-8ca9-545f4c527816	VIETCOMBANK	Vietcombank	https://orectic-noctilucent-ronan.ngrok-free.dev/images/bank-logo/vcb-logo.png	t	2026-08-16 19:03:37.065347+07
019fdc57-d943-7ea3-8b5f-5749cf0e48a1	MBBANK	MB Bank	https://orectic-noctilucent-ronan.ngrok-free.dev/images/bank-logo/mbbank-logo.png	t	2026-08-16 19:03:37.065347+07
\.


--
-- TOC entry 5031 (class 0 OID 16406)
-- Dependencies: 219
-- Data for Name: idempotency_keys; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.idempotency_keys (idempotency_key, actor_id, actor_type, request_path, status, response_body, request_hash, create_at, expires_at, response_status_code) FROM stdin;
019fdaa7-b4a5-7455-a28c-1da342b9cc77	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000008","status":"SUCCESS","createdAt":"2026-08-07T05:17:35.841Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9698000,"destBalanceAfter":191000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:17:35.796167+07	2026-08-14 12:17:35.796167+07	200
019fd245-e76d-7e02-95af-4a1d922d0e52	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":400,"message":"Số tiền chuyển phải từ 1 nghìn và tối đa là 50 triệu"}	cd08dc0acbe11ccfddfa6f7b1626ca18027436ceb32e1be77af0e37777315358	2026-08-05 21:15:57.948573+07	2026-08-12 21:15:57.948573+07	400
019fd24b-41bf-72ca-bf81-64c33ad4fe1f	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000000","status":"SUCCESS","createdAt":"2026-08-05T14:19:43.197Z","amount":100000,"fee":0,"description":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9900000,"destBalanceAfter":100000}}	475b98751a93d9bc94caf602a374ce8ade09de9a1fb1c2878eac822c5a4862ba	2026-08-05 21:19:43.153846+07	2026-08-12 21:19:43.153846+07	200
019fd25c-a62d-7a1e-8682-40c929b48652	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000001","status":"SUCCESS","createdAt":"2026-08-05T14:38:40.133Z","amount":100000,"fee":0,"description":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","sourceUserName":"Phan Văn Thống","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9800000,"destBalanceAfter":100000}}	aaa54e04bf2983c155367ffbd66ed694e05634351336d7a2b6a72557779b5fa4	2026-08-05 21:38:40.073771+07	2026-08-12 21:38:40.073771+07	200
019fd265-1c30-71af-b421-a694661c701e	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000002","status":"SUCCESS","createdAt":"2026-08-05T14:47:53.557Z","amount":60000,"fee":0,"description":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9740000,"destBalanceAfter":160000}}	ea411d463917b7cd97602c5f01869f56fc95699b16b0997991628ceffec935df	2026-08-05 21:47:53.506533+07	2026-08-12 21:47:53.506533+07	200
019fd269-83cf-7134-91bd-a15828462946	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000003","status":"SUCCESS","createdAt":"2026-08-05T14:52:43.390Z","amount":10000,"fee":0,"description":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9730000,"destBalanceAfter":170000}}	b65bc65c0a69a4dbe6aa283317445ac280963eb5976651446fa7f7e0f7f909dc	2026-08-05 21:52:43.341836+07	2026-08-12 21:52:43.341836+07	200
019fd26b-f264-7fdf-a9f2-bd7f54873e70	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000004","status":"SUCCESS","createdAt":"2026-08-05T14:55:22.214Z","amount":1000,"fee":0,"description":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","sourceUserName":"Phan Văn Thống","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9729000,"destBalanceAfter":101000}}	abc3ffa5474bffd4279b1de7221002ae761d7a8054e13d839fcab177d48f931c	2026-08-05 21:55:22.171227+07	2026-08-12 21:55:22.171227+07	200
019fd26d-418d-7a93-bd88-aa8ed5a6ebcc	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000005","status":"SUCCESS","createdAt":"2026-08-05T14:56:51.292Z","amount":1000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9728000,"destBalanceAfter":171000}}	2e5e3dad3ff8ae5745d4a3040ea571a6f9a24772a53f8f90ebee15da158b4e02	2026-08-05 21:56:51.249568+07	2026-08-12 21:56:51.249568+07	200
019fd287-4734-722d-8550-ce4b810e1c8f	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000006","status":"SUCCESS","createdAt":"2026-08-05T15:25:14.753Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9718000,"destBalanceAfter":111000}}	d66db5924de55a68bc4a6f5e27b4e04196fc63172eaee2e156f90b501cdf8fba	2026-08-05 22:25:14.712515+07	2026-08-12 22:25:14.712515+07	200
019fdaa1-10ed-7d51-a20f-7e45e49ad4af	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000007","status":"SUCCESS","createdAt":"2026-08-07T05:10:20.614Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9708000,"destBalanceAfter":181000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:10:20.572836+07	2026-08-14 12:10:20.572836+07	200
019fdabe-8f23-765b-9711-0ecd55f5b687	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000009","status":"SUCCESS","createdAt":"2026-08-07T05:42:34.669Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9688000,"destBalanceAfter":201000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:42:34.508152+07	2026-08-14 12:42:34.508152+07	200
019fdac0-a66f-77f4-bf27-064e3ba0e17d	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":400,"message":"Thiếu thông tin người gửi hoặc người nhận"}	3a1ede5f087f37ac9efc71a14f5b4c7d2f160563faaf57c9d213da0e6f8fb4bc	2026-08-07 12:44:55.691936+07	2026-08-14 12:44:55.691936+07	400
019fdabe-d73e-7da2-8213-2fde5cab1991	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":400,"message":"Thiếu thông tin người gửi hoặc người nhận"}	3a1ede5f087f37ac9efc71a14f5b4c7d2f160563faaf57c9d213da0e6f8fb4bc	2026-08-07 12:42:54.213007+07	2026-08-14 12:42:54.213007+07	400
019fdac1-cd4d-75f6-9bf9-2b8c2dd5e9b6	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000010","status":"SUCCESS","createdAt":"2026-08-07T05:46:06.005Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9678000,"destBalanceAfter":211000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:46:05.963927+07	2026-08-14 12:46:05.963927+07	200
019fdac3-a432-75bd-a954-0ebccb045735	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000011","status":"SUCCESS","createdAt":"2026-08-07T05:48:05.789Z","amount":10000,"fee":0,"description":"","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9668000,"destBalanceAfter":221000}}	17334b212ceea8f6741166802ce50fe54c34b80c3ecc8f4e6fff7ba813e3dbcd	2026-08-07 12:48:05.748283+07	2026-08-14 12:48:05.748283+07	200
019fdac5-bedc-7d19-be20-69da406a0501	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000012","status":"SUCCESS","createdAt":"2026-08-07T05:50:23.668Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9658000,"destBalanceAfter":231000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:50:23.574679+07	2026-08-14 12:50:23.574679+07	200
019fdac7-0353-7730-9b9f-bfdea0fad7cf	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000013","status":"SUCCESS","createdAt":"2026-08-07T05:51:47.050Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9648000,"destBalanceAfter":241000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:51:47.011646+07	2026-08-14 12:51:47.011646+07	200
019fdac8-16e5-7daa-a6bd-1fafb10ae0d1	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000014","status":"SUCCESS","createdAt":"2026-08-07T05:52:58.199Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9638000,"destBalanceAfter":251000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:52:58.159919+07	2026-08-14 12:52:58.159919+07	200
019fdacb-dda3-7a5f-ad1b-fedd66c2fb4f	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000015","status":"SUCCESS","createdAt":"2026-08-07T05:57:05.937Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9628000,"destBalanceAfter":261000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 12:57:05.897289+07	2026-08-14 12:57:05.897289+07	200
019fdad9-850c-7688-b1d0-f920b394ba46	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000016","status":"SUCCESS","createdAt":"2026-08-07T06:11:59.874Z","amount":100000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9528000,"destBalanceAfter":211000}}	0938868bb4ab862f9e2e2e0d4cf6c2b6d121bcaf52b395566420540c89dafb53	2026-08-07 13:11:59.835359+07	2026-08-14 13:11:59.835359+07	200
019fdaf4-31fa-7fd9-9de1-9442059e9da9	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000017","status":"SUCCESS","createdAt":"2026-08-07T06:41:07.545Z","amount":1000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9527000,"destBalanceAfter":262000}}	2e5e3dad3ff8ae5745d4a3040ea571a6f9a24772a53f8f90ebee15da158b4e02	2026-08-07 13:41:07.50411+07	2026-08-14 13:41:07.50411+07	200
019fdaf4-843a-7729-affe-15d0dcf748a4	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000018","status":"SUCCESS","createdAt":"2026-08-07T06:41:28.521Z","amount":100000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9427000,"destBalanceAfter":311000}}	e90e0e725d79fd3c7caa2349829ce9133339091d078d0a95721208590cf645e1	2026-08-07 13:41:28.478037+07	2026-08-14 13:41:28.478037+07	200
019fdafd-2cf0-7389-a0db-9a8c1ec757fb	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000019","status":"SUCCESS","createdAt":"2026-08-07T06:50:59.828Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9417000,"destBalanceAfter":272000}}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 13:50:59.789517+07	2026-08-14 13:50:59.789517+07	200
019fdc43-81a9-7fa7-96e9-5c101387654f	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":500,"message":"Hệ thống đang bảo trì!"}	10d1273f600cf7dc94a334e4cc61ad4bc8e6aab8c66715eb29f90a94e6de0097	2026-08-07 19:47:22.63388+07	2026-08-14 19:47:22.63388+07	500
019fdc48-c835-706d-ad20-8c29da773ca7	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000021","status":"SUCCESS","createdAt":"2026-08-07T12:53:08.546Z","amount":10000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9397000,"destBalanceAfter":321000}}	38291682727c11cbb4d78c4e0026372bdd2fdb09496264d823f7f127c7c74ce9	2026-08-07 19:53:08.505231+07	2026-08-14 19:53:08.505231+07	200
019fdc50-8623-756f-aeb8-528fd8fad5fd	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000022","status":"SUCCESS","createdAt":"2026-08-07T13:01:35.954Z","amount":1000,"fee":0,"description":"","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9396000,"destBalanceAfter":322000}}	9e436b941c299c0a6a51b2bbf44ec84635814cc22fb01ea3aebd66e3b7ec0ba7	2026-08-07 20:01:35.913881+07	2026-08-14 20:01:35.913881+07	200
019fdc52-17a8-7f80-a4ca-e76167962cb9	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000023","status":"SUCCESS","createdAt":"2026-08-07T13:03:19.951Z","amount":1000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":321000,"destBalanceAfter":9397000}}	9357729a6ad32a2157cd95805a46798ead23212610fd7a356f406e14b6cefe8c	2026-08-07 20:03:19.90884+07	2026-08-14 20:03:19.90884+07	200
019fdc53-9e79-774a-bacb-34499041060e	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000024","status":"SUCCESS","createdAt":"2026-08-07T13:04:58.549Z","amount":1000,"fee":0,"description":"","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":320000,"destBalanceAfter":9398000}}	aab14f3511ef92f37106a9eabbdd653755b7d309c8c856174e7930460b5ce576	2026-08-07 20:04:58.509383+07	2026-08-14 20:04:58.509383+07	200
019fdc54-1e2b-7139-b77d-c3a896e9ba67	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000025","status":"SUCCESS","createdAt":"2026-08-07T13:05:32.323Z","amount":10000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":310000,"destBalanceAfter":9408000}}	739b9a708d9fdb065874586f2d9ec53ea8ce00d0647618a8ee4268d26d012da8	2026-08-07 20:05:32.282021+07	2026-08-14 20:05:32.282021+07	200
019fdc57-7092-76d4-91fa-48508ebe044a	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000026","status":"SUCCESS","createdAt":"2026-08-07T13:09:09.389Z","amount":10000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":300000,"destBalanceAfter":9418000}}	739b9a708d9fdb065874586f2d9ec53ea8ce00d0647618a8ee4268d26d012da8	2026-08-07 20:09:09.347973+07	2026-08-14 20:09:09.347973+07	200
019fdc57-d943-7ea3-8b5f-5749cf0e48a1	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000027","status":"SUCCESS","createdAt":"2026-08-07T13:09:35.899Z","amount":1000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9417000,"destBalanceAfter":301000}}	653222958e0e7cbee0ff39c1edec5c425402dec9c4ae276e3e1761165091b53a	2026-08-07 20:09:35.858521+07	2026-08-14 20:09:35.858521+07	200
019fdc58-e9bf-7faf-ad31-4c0d2ce8d87b	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000028","status":"SUCCESS","createdAt":"2026-08-07T13:10:45.295Z","amount":1000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9416000,"destBalanceAfter":302000}}	653222958e0e7cbee0ff39c1edec5c425402dec9c4ae276e3e1761165091b53a	2026-08-07 20:10:45.255238+07	2026-08-14 20:10:45.255238+07	200
019fdc59-c826-71b5-a7eb-5dde0cc7a3dc	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000029","status":"SUCCESS","createdAt":"2026-08-07T13:11:42.366Z","amount":10000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9406000,"destBalanceAfter":312000}}	38291682727c11cbb4d78c4e0026372bdd2fdb09496264d823f7f127c7c74ce9	2026-08-07 20:11:42.326287+07	2026-08-14 20:11:42.326287+07	200
019fdc5a-a65d-75b4-8ca9-545f4c527816	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000030","status":"SUCCESS","createdAt":"2026-08-07T13:12:39.091Z","amount":1000,"fee":0,"description":"","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":311000,"destBalanceAfter":9407000}}	aab14f3511ef92f37106a9eabbdd653755b7d309c8c856174e7930460b5ce576	2026-08-07 20:12:39.050467+07	2026-08-14 20:12:39.050467+07	200
019fdc5a-e42b-7a86-86b9-0c291a1a5e8d	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000031","status":"SUCCESS","createdAt":"2026-08-07T13:12:56.671Z","amount":10000,"fee":0,"description":"","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":301000,"destBalanceAfter":9417000}}	16d44570843057fa7824a85912ecc4a33f3ff78f1e7211e71a671a7f57ff8c91	2026-08-07 20:12:56.63064+07	2026-08-14 20:12:56.63064+07	200
019fdc5d-4b65-7999-adc4-67ecd807f2db	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000032","status":"SUCCESS","createdAt":"2026-08-07T13:15:35.164Z","amount":10000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":291000,"destBalanceAfter":9427000}}	739b9a708d9fdb065874586f2d9ec53ea8ce00d0647618a8ee4268d26d012da8	2026-08-07 20:15:35.125166+07	2026-08-14 20:15:35.125166+07	200
019fdc5d-e49f-7bea-a5b5-f974aef3f671	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000033","status":"SUCCESS","createdAt":"2026-08-07T13:16:13.057Z","amount":100000,"fee":0,"description":"","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":191000,"destBalanceAfter":9527000}}	ca15475adaae2207c501c0bffd7a15dbaf80af8d33096ad2e33f5438aa56e365	2026-08-07 20:16:13.017119+07	2026-08-14 20:16:13.017119+07	200
019fdc61-d68c-7936-bb26-31c8e1ccff94	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000034","status":"SUCCESS","createdAt":"2026-08-07T13:20:30.749Z","amount":1000,"fee":0,"description":"","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":190000,"destBalanceAfter":9528000}}	aab14f3511ef92f37106a9eabbdd653755b7d309c8c856174e7930460b5ce576	2026-08-07 20:20:30.709136+07	2026-08-14 20:20:30.709136+07	200
019fdc62-b264-7f3c-97f8-3c3072e1d5f1	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000035","status":"SUCCESS","createdAt":"2026-08-07T13:21:26.554Z","amount":1000,"fee":0,"description":"","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":189000,"destBalanceAfter":9529000}}	aab14f3511ef92f37106a9eabbdd653755b7d309c8c856174e7930460b5ce576	2026-08-07 20:21:26.513558+07	2026-08-14 20:21:26.513558+07	200
019fdc64-895f-7bc2-8450-661703cf4161	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000036","status":"SUCCESS","createdAt":"2026-08-07T13:23:27.384Z","amount":1000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":188000,"destBalanceAfter":9530000}}	c76852f6007c01ae0d311237ec1f9a9614265c491dd007d218059e33eeec2909	2026-08-07 20:23:27.334399+07	2026-08-14 20:23:27.334399+07	200
019fdc68-0dd6-7d5a-a711-ff2f6e79d89f	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000037","status":"SUCCESS","createdAt":"2026-08-07T13:27:19.231Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9520000,"destBalanceAfter":198000}}	d66db5924de55a68bc4a6f5e27b4e04196fc63172eaee2e156f90b501cdf8fba	2026-08-07 20:27:19.188326+07	2026-08-14 20:27:19.188326+07	200
019fdc6d-9d5d-7e46-9ad1-700fc17c21f8	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":400,"message":"Không thể chuyển tiền cho chính mình"}	38291682727c11cbb4d78c4e0026372bdd2fdb09496264d823f7f127c7c74ce9	2026-08-07 20:33:22.243287+07	2026-08-14 20:33:22.243287+07	400
019fdc6d-e760-798a-aeb2-d5ab30365096	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000038","status":"SUCCESS","createdAt":"2026-08-07T13:33:44.313Z","amount":10000,"fee":0,"description":" Mình chuyển tiền nhé 💵","sourceUserName":"Dương Gian","destinationId":"019f59d0-766b-708b-bf3f-6d55e1232c89","destinationUserName":"Phan Văn Thống","destinationPhone":"0855313437","sourceBalanceAfter":188000,"destBalanceAfter":9530000}}	739b9a708d9fdb065874586f2d9ec53ea8ce00d0647618a8ee4268d26d012da8	2026-08-07 20:33:44.267348+07	2026-08-14 20:33:44.267348+07	200
01a01a01-cf42-7bee-b333-e29b31f40b4b	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000039","status":"SUCCESS","createdAt":"2026-08-19T12:32:04.605Z","amount":10000,"fee":0,"description":"","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9520000,"destBalanceAfter":198000}}	d70a0b3711c121de593f06b919f3d937e02ea5375af150899940502a05a72b46	2026-08-19 19:32:04.591282+07	2026-08-26 19:32:04.591282+07	200
01a01f82-6d2f-79de-845d-9eaaadebccfe	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":400,"message":"Thiếu thông tin người gửi hoặc người nhận"}	e40482102f6f13b29addb698096eaf88c97b56f1c7c2919805593014734ecb29	2026-08-20 21:10:41.490559+07	2026-08-27 21:10:41.490559+07	400
01a01f83-8ad4-791f-9dee-b44fa6a7ef3f	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	FAILED	{"status":"error","code":500,"message":"Hệ thống đang bảo trì!"}	f5b1df692a8342cb5f98b385714af9d67aaea4e787cff4614acf7d94fff377ad	2026-08-20 21:11:52.955533+07	2026-08-27 21:11:52.955533+07	500
01a01f90-9a95-7c9c-8c1a-8de293e307e0	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	FAILED	{"status":"error","code":400,"message":"Dữ liệu đã tồn tại"}	32fd6335d4064fee68b58a25e84e6a5500aa3deae32bbf05f0e5cafb6dbe2fa7	2026-08-20 21:26:08.691787+07	2026-08-27 21:26:08.691787+07	400
01a01f92-239c-7f29-bbf3-a52acfb5ac50	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000043","status":"SUCCESS","createdAt":"2026-08-20T14:27:48.720Z","amount":6666,"fee":0,"sourceBalanceAfter":9599998,"bankName":"Vietcombank"}}	32fd6335d4064fee68b58a25e84e6a5500aa3deae32bbf05f0e5cafb6dbe2fa7	2026-08-20 21:27:48.718965+07	2026-08-27 21:27:48.718965+07	200
01a024a0-f1ff-731d-92a8-ecaa5fee83e9	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000045","status":"SUCCESS","createdAt":"2026-08-21T14:07:57.786Z","amount":66666,"fee":0,"sourceBalanceAfter":9673330,"bankName":"MB Bank"}}	9fa63d93f0f95573a3ce821a45072bf66104b725963d2a5cda6d0670ccea3569	2026-08-21 21:07:57.781876+07	2026-08-28 21:07:57.781876+07	200
01a0249c-84b9-7ba0-9142-41dc5f68f310	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	FAILED	{"status":"error","code":400,"message":"Thiếu thông tin người gửi hoặc người nhận"}	f5b1df692a8342cb5f98b385714af9d67aaea4e787cff4614acf7d94fff377ad	2026-08-21 20:57:17.15453+07	2026-08-28 20:57:17.15453+07	400
01a024a0-b2c8-7218-b2a3-8835b83552ea	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000044","status":"SUCCESS","createdAt":"2026-08-21T14:01:50.699Z","amount":6666,"fee":0,"sourceBalanceAfter":9606664,"bankName":"Vietcombank"}}	32fd6335d4064fee68b58a25e84e6a5500aa3deae32bbf05f0e5cafb6dbe2fa7	2026-08-21 21:01:50.693794+07	2026-08-28 21:01:50.693794+07	200
01a024ac-6221-7a76-91e1-fbd12785a625	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/withdrawn	FAILED	{"status":"error","code":500,"message":"Hệ thống đang bảo trì!"}	9fa63d93f0f95573a3ce821a45072bf66104b725963d2a5cda6d0670ccea3569	2026-08-21 21:14:38.178653+07	2026-08-28 21:14:38.178653+07	500
01a024af-b0b2-70c8-8160-b74cfd2fc835	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/withdraw	SUCCESS	{"status":"success","code":200,"message":"Rút tiền thành công","data":{"transactionId":"100000000046","status":"SUCCESS","createdAt":"2026-08-21T14:18:13.479Z","amount":66666,"fee":0,"sourceBalanceAfter":9606664,"bankName":"MB Bank"}}	9fa63d93f0f95573a3ce821a45072bf66104b725963d2a5cda6d0670ccea3569	2026-08-21 21:18:13.478519+07	2026-08-28 21:18:13.478519+07	200
01a024af-efc2-7a02-819f-4aa6982e3f6b	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/withdraw	SUCCESS	{"status":"success","code":200,"message":"Rút tiền thành công","data":{"transactionId":"100000000047","status":"SUCCESS","createdAt":"2026-08-21T14:18:27.997Z","amount":100000,"fee":0,"sourceBalanceAfter":9506664,"bankName":"Vietcombank"}}	13dade8ae5417cd1a3676bd1153e2c02ecda47b2d4cb9741fe8a760256cbdb23	2026-08-21 21:18:27.993132+07	2026-08-28 21:18:27.993132+07	200
01a024b0-252f-76d2-8c4f-6298bdecde39	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000048","status":"SUCCESS","createdAt":"2026-08-21T14:18:44.260Z","amount":66666,"fee":0,"sourceBalanceAfter":9573330,"bankName":"Vietcombank"}}	f5b1df692a8342cb5f98b385714af9d67aaea4e787cff4614acf7d94fff377ad	2026-08-21 21:18:44.255936+07	2026-08-28 21:18:44.255936+07	200
01a02ee5-1b96-7c1c-9907-c1d913cbeaf7	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000049","status":"SUCCESS","createdAt":"2026-08-23T13:53:12.771Z","amount":66666,"fee":0,"sourceBalanceAfter":9639996,"bankName":"Vietcombank"}}	f5b1df692a8342cb5f98b385714af9d67aaea4e787cff4614acf7d94fff377ad	2026-08-23 20:53:12.754213+07	2026-08-30 20:53:12.754213+07	200
01a02eed-cbe6-7e95-af36-b4b645d84a71	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000050","status":"SUCCESS","createdAt":"2026-08-23T14:02:32.022Z","amount":10000,"fee":0,"description":"","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9629996,"destBalanceAfter":208000}}	d70a0b3711c121de593f06b919f3d937e02ea5375af150899940502a05a72b46	2026-08-23 21:02:32.02092+07	2026-08-30 21:02:32.02092+07	200
01a02ef2-b700-75e7-885f-969427f3a227	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000051","status":"SUCCESS","createdAt":"2026-08-23T14:07:39.115Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9619996,"destBalanceAfter":218000}}	d66db5924de55a68bc4a6f5e27b4e04196fc63172eaee2e156f90b501cdf8fba	2026-08-23 21:07:39.111089+07	2026-08-30 21:07:39.111089+07	200
01a02ef4-7b61-7c94-886d-b1336901e2ed	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000052","status":"SUCCESS","createdAt":"2026-08-23T14:09:33.325Z","amount":6666,"fee":0,"description":"","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b11","destinationUserName":"Lý Lạc Bình","destinationPhone":"0982314632","sourceBalanceAfter":9613330,"destBalanceAfter":288666}}	7b88043d289032dc572c5e29ee198ce29be186f013e19697398c4b8bda8d90ff	2026-08-23 21:09:33.319935+07	2026-08-30 21:09:33.319935+07	200
01a02ef5-9205-7c08-9c52-13fc78300e66	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000053","status":"SUCCESS","createdAt":"2026-08-23T14:10:43.540Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9603330,"destBalanceAfter":228000}}	d66db5924de55a68bc4a6f5e27b4e04196fc63172eaee2e156f90b501cdf8fba	2026-08-23 21:10:43.535656+07	2026-08-30 21:10:43.535656+07	200
01a02ef5-b325-7cdb-ac66-3afd24640767	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000054","status":"SUCCESS","createdAt":"2026-08-23T14:10:51.764Z","amount":10000,"fee":0,"description":"","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9593330,"destBalanceAfter":238000}}	d70a0b3711c121de593f06b919f3d937e02ea5375af150899940502a05a72b46	2026-08-23 21:10:51.763573+07	2026-08-30 21:10:51.763573+07	200
01a02ef6-dca1-7fcb-917a-3064e6566e0d	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000055","status":"SUCCESS","createdAt":"2026-08-23T14:12:08.185Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9583330,"destBalanceAfter":248000}}	d66db5924de55a68bc4a6f5e27b4e04196fc63172eaee2e156f90b501cdf8fba	2026-08-23 21:12:08.184758+07	2026-08-30 21:12:08.184758+07	200
01a04152-8a4a-7cb4-b219-22a5bba06a9e	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000056","status":"SUCCESS","createdAt":"2026-08-27T03:45:31.200Z","amount":10000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"PHAN VĂN THỐNG","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9573330,"destBalanceAfter":258000}}	d66db5924de55a68bc4a6f5e27b4e04196fc63172eaee2e156f90b501cdf8fba	2026-08-27 10:45:31.185021+07	2026-09-03 10:45:31.185021+07	200
01a04152-f4b6-79f7-867b-85b9f4df0d1c	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/withdraw	SUCCESS	{"status":"success","code":200,"message":"Rút tiền thành công","data":{"transactionId":"100000000057","status":"SUCCESS","createdAt":"2026-08-27T03:46:01.439Z","amount":66666,"fee":0,"sourceBalanceAfter":9506664,"bankName":"MB Bank"}}	9fa63d93f0f95573a3ce821a45072bf66104b725963d2a5cda6d0670ccea3569	2026-08-27 10:46:01.433246+07	2026-09-03 10:46:01.433246+07	200
01a04192-a796-7705-a388-669c16762b34	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000058","status":"SUCCESS","createdAt":"2026-08-27T04:55:33.372Z","amount":666666,"fee":0,"sourceBalanceAfter":10173330,"bankName":"MB Bank"}}	e40482102f6f13b29addb698096eaf88c97b56f1c7c2919805593014734ecb29	2026-08-27 11:55:33.360392+07	2026-09-03 11:55:33.360392+07	200
01a04196-bd45-7b50-88ce-636cff9a155a	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000059","status":"SUCCESS","createdAt":"2026-08-27T04:59:58.101Z","amount":3000,"fee":0,"sourceBalanceAfter":10176330,"bankName":"MB Bank"}}	4d85b16c305a21495c09a1ff7a51faf4e919c1b178ef056a15d2c0cda5041ac8	2026-08-27 11:59:58.096654+07	2026-09-03 11:59:58.096654+07	200
01a04196-f32c-7af1-94f6-c545842b6ee5	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000060","status":"SUCCESS","createdAt":"2026-08-27T05:00:10.450Z","amount":1000,"fee":0,"sourceBalanceAfter":10177330,"bankName":"MB Bank"}}	9a3aded5a4f3c67426d34c61d340a99e4be7ce13dba97d3af46275880e712bbf	2026-08-27 12:00:10.44938+07	2026-09-03 12:00:10.44938+07	200
01a04197-29bb-7d11-a1be-8d03c5ca64a9	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/withdraw	SUCCESS	{"status":"success","code":200,"message":"Rút tiền thành công","data":{"transactionId":"100000000061","status":"SUCCESS","createdAt":"2026-08-27T05:00:24.843Z","amount":66666,"fee":0,"sourceBalanceAfter":10110664,"bankName":"MB Bank"}}	9fa63d93f0f95573a3ce821a45072bf66104b725963d2a5cda6d0670ccea3569	2026-08-27 12:00:24.841795+07	2026-09-03 12:00:24.841795+07	200
01a04199-efad-73fd-bbba-0026f0fefb9c	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000062","status":"SUCCESS","createdAt":"2026-08-27T05:03:25.520Z","amount":6666,"fee":0,"sourceBalanceAfter":10117330,"bankName":"Vietcombank"}}	32fd6335d4064fee68b58a25e84e6a5500aa3deae32bbf05f0e5cafb6dbe2fa7	2026-08-27 12:03:25.514065+07	2026-09-03 12:03:25.514065+07	200
01a12934-9e7c-7531-9aa9-42b0245b8efd	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/transfer	SUCCESS	{"status":"success","code":200,"message":"Chuyển tiền thành công","data":{"transactionId":"100000000063","status":"SUCCESS","createdAt":"2026-10-11T04:25:36.266Z","amount":100000,"fee":0,"description":" Cảm ơn nha 👍🫰","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":10017330,"destBalanceAfter":358000}}	e90e0e725d79fd3c7caa2349829ce9133339091d078d0a95721208590cf645e1	2026-10-11 11:25:36.257777+07	2026-10-18 11:25:36.257777+07	200
01a12936-0e8d-7b9e-ba29-1bdb457b36a4	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/qr-payment	SUCCESS	{"status":"success","code":200,"message":"Thanh toán QR thành công","data":{"transactionId":"100000000064","status":"SUCCESS","createdAt":"2026-10-11T04:27:08.585Z","amount":"66666","fee":0,"description":"hhhh","sourceUserName":"Phan Văn Thống","destinationId":"019f4b7a-1ef3-736c-ba4e-077b9ce03b59","destinationUserName":"Dương Gian","destinationPhone":"0332330072","sourceBalanceAfter":9950664,"destBalanceAfter":424666}}	cb12535f1ff8d3d497d5406965fba588f6eb63f78970a32485830829c44cd37c	2026-10-11 11:27:08.583288+07	2026-10-18 11:27:08.583288+07	200
01a1294a-a918-74af-a4e9-38e28c41a345	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/withdraw	SUCCESS	{"status":"success","code":200,"message":"Rút tiền thành công","data":{"transactionId":"100000000065","status":"SUCCESS","createdAt":"2026-10-11T04:49:57.426Z","amount":66666,"fee":0,"sourceBalanceAfter":9883998,"bankName":"Vietcombank"}}	f5b1df692a8342cb5f98b385714af9d67aaea4e787cff4614acf7d94fff377ad	2026-10-11 11:49:57.424245+07	2026-10-18 11:49:57.424245+07	200
01a1294b-3a31-77c2-a789-512e2a670188	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	/api/v2/transaction/topup	FAILED	{"status":"error","code":422,"message":"Số dư ngân hàng không đủ để thực hiện giao dịch"}	7995055812205b43fb9f66c0f7b6243893f48ad2ecfe0d68ea484a57878ae751	2026-10-11 11:50:14.346041+07	2026-10-18 11:50:14.346041+07	422
01a13415-9fff-7a74-8c9b-98c50d721128	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000066","status":"SUCCESS","createdAt":"2026-10-13T07:06:39.469Z","amount":66666,"fee":0,"sourceUserName":"Dương Gian","sourceBalanceAfter":491332,"bankName":"MB Bank"}}	fce535481323128746ba0bc741e8e6a4c7707e1546db0f2819a6b8f5a7557ddf	2026-10-13 14:06:39.462269+07	2026-10-20 14:06:39.462269+07	200
01a1341e-9284-7370-b127-1d025d1318bb	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/topup	SUCCESS	{"status":"success","code":200,"message":"Nạp tiền thành công","data":{"transactionId":"100000000067","status":"SUCCESS","createdAt":"2026-10-13T07:16:30.188Z","amount":200000,"fee":0,"sourceUserName":"Dương Gian","sourceBalanceAfter":691332,"bankName":"Vietcombank"}}	04076b07d75c0b02854540c0a915aa8f4a6858a2ce08fc58b07420f784207d02	2026-10-13 14:16:30.184315+07	2026-10-20 14:16:30.184315+07	200
01a13423-8f29-7798-8bb3-3087e546a024	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	/api/v2/transaction/withdraw	SUCCESS	{"status":"success","code":200,"message":"Rút tiền thành công","data":{"transactionId":"100000000068","status":"SUCCESS","createdAt":"2026-10-13T07:21:50.983Z","amount":666666,"fee":0,"sourceUserName":"Dương Gian","sourceBalanceAfter":24666,"bankName":"Vietcombank"}}	35093738b0f5e99e76c51ba80c5bcebde816ff369304c143d05e199e068bf638	2026-10-13 14:21:50.981768+07	2026-10-20 14:21:50.981768+07	200
\.


--
-- TOC entry 5032 (class 0 OID 16414)
-- Dependencies: 220
-- Data for Name: linked_bank_accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.linked_bank_accounts (id, user_id, bank_id, account_number, account_holder_name, balance, is_default, status, created_at, updated_at) FROM stdin;
01a01014-f7ca-7531-88b6-ee74f95f642e	019f59d0-766b-708b-bf3f-6d55e1232c89	019fdc57-d943-7ea3-8b5f-5749cf0e48a1	0855313437	Phan Văn Thống	9462666	f	ACTIVE	2026-08-17 21:16:44.747504+07	2026-08-17 21:16:44.747504+07
01a01a2d-7ec0-7d75-a9cd-21d5496e8202	019f59d0-766b-708b-bf3f-6d55e1232c89	019fdc5a-a65d-75b4-8ca9-545f4c527816	0855313437	Phan Văn Thống	9940004	f	ACTIVE	2026-08-19 20:19:44.322182+07	2026-08-19 20:19:44.322182+07
01a1294a-df66-7304-ad9e-5e1e9266641e	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	019fdc57-d943-7ea3-8b5f-5749cf0e48a1	0332330072	Dương Gian	9933334	f	ACTIVE	2026-10-11 11:48:55.143295+07	2026-10-11 11:48:55.143295+07
01a1341e-721e-703a-ab28-df64a9b85e9e	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	019fdc5a-a65d-75b4-8ca9-545f4c527816	0332330072	Dương Gian	10466666	f	ACTIVE	2026-10-13 14:16:12.959249+07	2026-10-13 14:16:12.959249+07
\.


--
-- TOC entry 5033 (class 0 OID 16423)
-- Dependencies: 221
-- Data for Name: otp_tracking; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.otp_tracking (id, email, otp_hash, failed_attempts, locked_until, expired_at, used_at, created_at, phone) FROM stdin;
01a133bb-f3e6-7644-bb98-4a95b91e4086	\N	$2b$10$quqyyN4ONF/VHxYLdMMDSeYFr4U4vZ59fAHjMBMXWXOYd1Q4Cb/BW	0	\N	2026-10-13 14:32:30.44913+07	\N	2026-10-13 14:27:30.44913+07	0855555555
01a133c9-2e26-7223-942a-f462a3c4530a	\N	$2b$10$HEW3XeSU6gLdEmGazlpTTuOsUvQbVTFQOveb9INQsAH3ct82qLu0q	0	\N	2026-10-13 12:48:04.999985+07	\N	2026-10-13 12:43:04.999985+07	0885555555
01a133d2-c17c-7510-91b9-8f511883de20	\N	$2b$10$yHlmRCfi6ULfaSJV5ZkyTOA6b/gcQKxN6JdFcHjic0775WIxk/Es6	0	\N	2026-10-13 12:58:32.542757+07	\N	2026-10-13 12:53:32.542757+07	0333663366
01a133d4-fbe0-71f5-abce-e1f28961a541	\N	$2b$10$l9dM32XMVI1pKB8S8a2aX.wak5kiIAYnFuqi0he8aa0/BE4LO4zGC	0	\N	2026-10-13 13:00:58.561035+07	\N	2026-10-13 12:55:58.561035+07	0855313499
01a133d9-c805-718e-b447-a9873e9e6771	\N	$2b$10$lFuTPQq05PCrOJPxvIYXKe4U9AHuKanPn.Tb4SSa9LbRaMHr.2vri	0	\N	2026-10-13 13:06:12.967705+07	\N	2026-10-13 13:01:12.967705+07	0856656555
01a041f1-ffa6-7028-a7d2-c1fd86217216	\N	$2b$10$zGYeB3ShAVFK/tUpry4Be.osBbKKgkwULbGdGv8bIe5ZQYX.bFse2	0	\N	2026-08-27 13:45:19.587537+07	2026-08-27 13:40:30.683376+07	2026-08-27 13:40:19.587537+07	0823456799
01a13424-9baf-7ba3-a18f-6c49c7ed5cd5	thongpvt002@gmail.com	$2b$10$fyfoe2t.H0GFwodtiuQQ6ODdn9nBjDK9FfhNXW6l1B3CsNy/VzDW6	0	\N	2026-10-13 14:33:58.51184+07	2026-10-13 14:29:45.500577+07	2026-10-13 14:28:58.51184+07	\N
01a133e1-7339-77dd-be5a-218b88f72ce4	\N	$2b$10$M0.bN8WMw4XxQmLIyJmVje7lVoCYeI3q7eNFRIKt2KOmJZMFg7Me2	0	\N	2026-10-13 13:14:35.547124+07	\N	2026-10-13 13:09:35.547124+07	0868565855
01a133e8-0800-7f4f-b285-11635636f06e	\N	$2b$10$LcIMPyykQfW6ku5gMHQ/keDw9XG7pK6mt4jG4IU.pDKw9zsuvaXs6	0	\N	2026-10-13 13:21:46.848808+07	\N	2026-10-13 13:16:46.848808+07	0888866556
01a13fb4-03af-79c2-a69b-77d4e5979272	thongpvt004@gmail.com	$2b$10$nFFtq1xnm19mPuiolOnJzeUaL/gqdUCw5gIyrVYb.ez8NElwuorKi	0	\N	2026-10-15 20:58:07.035828+07	2026-10-15 20:53:24.519639+07	2026-10-15 20:53:07.035828+07	\N
01a04209-119d-76c5-95ac-1f9b8fc397e4	\N	$2b$10$vca/4YRpKsgTbYbNeZ87ven2jOSm1NxFLAig45J9Utl0wGGG9BP/K	0	\N	2026-08-27 14:09:45.726756+07	2026-08-27 14:04:52.546896+07	2026-08-27 14:04:45.726756+07	0888888888
01a0420b-1bd4-7972-9cbc-9020f66c2d1a	\N	$2b$10$WbyoXB3mTf53m9km6gpImODcZu7al3iEczoqktmS/5WC9kWlE8tjq	0	\N	2026-08-27 14:11:59.414121+07	2026-08-27 14:07:06.849556+07	2026-08-27 14:06:59.414121+07	0866666666
01a0420d-cd73-732d-9298-6f18acebc224	\N	$2b$10$0DXGnVkNAVubntnKwnHBE./wkVlW4c0tcenZCed/PUuZsHnQZvuXm	0	\N	2026-08-27 14:14:55.956037+07	2026-08-27 14:10:02.983957+07	2026-08-27 14:09:55.956037+07	0877777777
01a1294e-3cc7-7a97-8d19-ffabe6d9c7ef	\N	$2b$10$GQV1FtpTaGVbmFMBYyO1oOinF11Oj8haVIgYanmXWqkrWoHge9KJG	0	\N	2026-10-11 11:57:35.656588+07	\N	2026-10-11 11:52:35.656588+07	0866666669
01a133b9-0532-7bc9-9b07-ec43437c5db1	thongpvt003@gmail.com	$2b$10$cgEkooWWK/tt.gWxwKqxg.DiusHMLUbpTMLx4L6bGw4cGERaIFX0.	0	\N	2026-10-13 20:07:10.078946+07	\N	2026-10-13 20:02:10.078946+07	\N
01a133f7-5b89-7169-897b-769a151801b8	\N	$2b$10$OaBv6ZX6YM0a6.4sHnvJXuY0sFIdjNUtoYkiPfUHIN5D8URhOCahG	0	\N	2026-10-13 13:40:06.026587+07	\N	2026-10-13 13:35:06.026587+07	0366396555
01a133fd-946d-7e85-9481-049bae19e48b	\N	$2b$10$wreBfPqoev5FxX1R29WeO.bgMQP6UqOlLGm/VC6yZkcuphz84aicm	0	\N	2026-10-13 13:45:19.054368+07	\N	2026-10-13 13:40:19.054368+07	0866566655
01a13fc2-6a4e-7f1e-8a8a-9f6b3ea02fbd	thongptv004@gmail.com	$2b$10$ncWXDivXuHFyl4r24KAtCeK/DydYY09y/m0btndcN2qmXl/6XTyNW	0	\N	2026-10-15 20:36:08.23973+07	\N	2026-10-15 20:31:08.23973+07	\N
01a041e9-e339-730d-a836-3415ef0c8cca	\N	$2b$10$FHHZsdSqqnPSekaRIq1gxeyvhAQCPaIHRQW/zeXLQwinnMIb98dV2	0	\N	2026-10-11 13:25:01.043834+07	2026-10-11 13:20:07.359273+07	2026-10-11 13:20:01.043834+07	0855313437
01a13424-1fe3-749c-923f-a9b8eedc9321	\N	$2b$10$QQgplzu1nuIijGuVYoCLx.0C.eUvAfoSC88edmiNxbY9W3fXlWUJC	0	\N	2026-10-13 14:27:25.123456+07	\N	2026-10-13 14:22:25.123456+07	0855319655
01a1295a-10f9-7916-ae8a-4c2462c098cb	\N	$2b$10$XvwkH9I.NuTyCUX3Es6cy.BY3EMJh.6vlBKMDhzNCS32A9ssHo/4O	0	\N	2026-10-11 13:33:33.43158+07	2026-10-11 13:28:53.081436+07	2026-10-11 13:28:33.43158+07	0332330072
01a133ac-4374-7cf3-8ce2-34239a4ed8b0	\N	$2b$10$ImcU.EpGMazpow1BnTrxbOpOkCQ1owSAetRSx1OGRV0zZhY251VOW	0	\N	2026-10-13 12:24:27.048267+07	\N	2026-10-13 12:19:27.048267+07	0999999999
01a133b6-e420-7154-8c0a-2413a94d703c	\N	$2b$10$Ndam.0ZCX5MCE8SzJScgBe8FOYaye/4yIvNvBYaTNgEl2y9YhLhdm	0	\N	2026-10-13 12:28:06.401723+07	\N	2026-10-13 12:23:06.401723+07	0888888666
\.


--
-- TOC entry 5034 (class 0 OID 16431)
-- Dependencies: 222
-- Data for Name: payment_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_requests (id, reference_code, destination_user_id, source_user_id, transaction_id, amount, description, status, expires_at, paid_at, created_at, updated_at) FROM stdin;
01a01a03-8e12-776f-a6b3-3b2d4963812b	ivMysUWjmqK8jPBJ	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	\N	66636	ghggghh	PENDING	2026-08-19 19:48:55.733043+07	\N	2026-08-19 19:33:55.733043+07	2026-08-19 19:33:55.733043+07
01a0419a-4690-78ff-b9fc-64164382b363	Nvv4X77tSQQuPdyL	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	\N	66666	hhhh	PENDING	2026-08-27 12:18:44.784981+07	\N	2026-08-27 12:03:44.784981+07	2026-08-27 12:03:44.784981+07
01a12936-4b59-7656-8822-bfe8afd8d28d	JhBmGkYgHMXEJ6ET	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	\N	66666		PENDING	2026-10-11 11:41:26.521615+07	\N	2026-10-11 11:26:26.521615+07	2026-10-11 11:26:26.521615+07
01a12936-b6e9-7187-9466-a93a07d3bedc	LNfSLLa72PKbzZY4	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	019f59d0-766b-708b-bf3f-6d55e1232c89	100000000064	66666	hhhh	PAID	2026-10-11 11:41:54.057544+07	2026-10-11 11:27:08.585133+07	2026-10-11 11:26:54.057544+07	2026-10-11 11:27:08.585133+07
01a13423-12a0-70d2-ac3f-a38a37b39895	9iJpEHZVn43cXmyr	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	\N	666666		PENDING	2026-10-13 14:36:16.19384+07	\N	2026-10-13 14:21:16.19384+07	2026-10-13 14:21:16.19384+07
01a1354f-5211-7726-981b-78021f1d015a	X6NUab2mdVSTQMYP	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	\N	6666	hhh	PENDING	2026-10-13 20:04:13.238964+07	\N	2026-10-13 19:49:13.238964+07	2026-10-13 19:49:13.238964+07
\.


--
-- TOC entry 5036 (class 0 OID 16441)
-- Dependencies: 224
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.transactions (id, transaction_type, source_user_id, source_balance_before, source_balance_after, destination_user_id, dest_balance_before, dest_balance_after, amount, fee, status, description, idempotency_key, created_at, completed_at, linked_bank_account_id) FROM stdin;
100000000000	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	10000000	9900000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	0	100000	100000	0	SUCCESS	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	019fd24b-41bf-72ca-bf81-64c33ad4fe1f	2026-08-05 21:19:43.19796+07	2026-08-05 21:19:43.19796+07	\N
100000000001	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9900000	9800000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	0	100000	100000	0	SUCCESS	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	019fd25c-a62d-7a1e-8682-40c929b48652	2026-08-05 21:38:40.133753+07	2026-08-05 21:38:40.133753+07	\N
100000000002	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9800000	9740000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	100000	160000	60000	0	SUCCESS	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	019fd265-1c30-71af-b421-a694661c701e	2026-08-05 21:47:53.557595+07	2026-08-05 21:47:53.557595+07	\N
100000000003	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9740000	9730000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	160000	170000	10000	0	SUCCESS	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	019fd269-83cf-7134-91bd-a15828462946	2026-08-05 21:52:43.39083+07	2026-08-05 21:52:43.39083+07	\N
100000000004	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9730000	9729000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	100000	101000	1000	0	SUCCESS	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	019fd26b-f264-7fdf-a9f2-bd7f54873e70	2026-08-05 21:55:22.214584+07	2026-08-05 21:55:22.214584+07	\N
100000000005	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9729000	9728000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	170000	171000	1000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fd26d-418d-7a93-bd88-aa8ed5a6ebcc	2026-08-05 21:56:51.29284+07	2026-08-05 21:56:51.29284+07	\N
100000000006	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9728000	9718000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	101000	111000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fd287-4734-722d-8550-ce4b810e1c8f	2026-08-05 22:25:14.753269+07	2026-08-05 22:25:14.753269+07	\N
100000000007	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9718000	9708000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	171000	181000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdaa1-10ed-7d51-a20f-7e45e49ad4af	2026-08-07 12:10:20.614622+07	2026-08-07 12:10:20.614622+07	\N
100000000008	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9708000	9698000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	181000	191000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdaa7-b4a5-7455-a28c-1da342b9cc77	2026-08-07 12:17:35.841035+07	2026-08-07 12:17:35.841035+07	\N
100000000009	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9698000	9688000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	191000	201000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdabe-8f23-765b-9711-0ecd55f5b687	2026-08-07 12:42:34.669458+07	2026-08-07 12:42:34.669458+07	\N
100000000010	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9688000	9678000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	201000	211000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdac1-cd4d-75f6-9bf9-2b8c2dd5e9b6	2026-08-07 12:46:06.005014+07	2026-08-07 12:46:06.005014+07	\N
100000000011	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9678000	9668000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	211000	221000	10000	0	SUCCESS		019fdac3-a432-75bd-a954-0ebccb045735	2026-08-07 12:48:05.789835+07	2026-08-07 12:48:05.789835+07	\N
100000000012	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9668000	9658000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	221000	231000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdac5-bedc-7d19-be20-69da406a0501	2026-08-07 12:50:23.668656+07	2026-08-07 12:50:23.668656+07	\N
100000000013	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9658000	9648000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	231000	241000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdac7-0353-7730-9b9f-bfdea0fad7cf	2026-08-07 12:51:47.050717+07	2026-08-07 12:51:47.050717+07	\N
100000000014	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9648000	9638000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	241000	251000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdac8-16e5-7daa-a6bd-1fafb10ae0d1	2026-08-07 12:52:58.199001+07	2026-08-07 12:52:58.199001+07	\N
100000000015	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9638000	9628000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	251000	261000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdacb-dda3-7a5f-ad1b-fedd66c2fb4f	2026-08-07 12:57:05.937192+07	2026-08-07 12:57:05.937192+07	\N
100000000016	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9628000	9528000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	111000	211000	100000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdad9-850c-7688-b1d0-f920b394ba46	2026-08-07 13:11:59.874201+07	2026-08-07 13:11:59.874201+07	\N
100000000017	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9528000	9527000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	261000	262000	1000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdaf4-31fa-7fd9-9de1-9442059e9da9	2026-08-07 13:41:07.545264+07	2026-08-07 13:41:07.545264+07	\N
100000000018	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9527000	9427000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	211000	311000	100000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdaf4-843a-7729-affe-15d0dcf748a4	2026-08-07 13:41:28.521153+07	2026-08-07 13:41:28.521153+07	\N
100000000019	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9427000	9417000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	262000	272000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdafd-2cf0-7389-a0db-9a8c1ec757fb	2026-08-07 13:50:59.828443+07	2026-08-07 13:50:59.828443+07	\N
100000000020	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9417000	9407000	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	272000	282000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdc43-81a9-7fa7-96e9-5c101387654f	2026-08-07 19:47:22.676735+07	2026-08-07 19:47:22.676735+07	\N
100000000021	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9407000	9397000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	311000	321000	10000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc48-c835-706d-ad20-8c29da773ca7	2026-08-07 19:53:08.546527+07	2026-08-07 19:53:08.546527+07	\N
100000000022	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9397000	9396000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	321000	322000	1000	0	SUCCESS		019fdc50-8623-756f-aeb8-528fd8fad5fd	2026-08-07 20:01:35.954866+07	2026-08-07 20:01:35.954866+07	\N
100000000023	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	322000	321000	019f59d0-766b-708b-bf3f-6d55e1232c89	9396000	9397000	1000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdc52-17a8-7f80-a4ca-e76167962cb9	2026-08-07 20:03:19.95141+07	2026-08-07 20:03:19.95141+07	\N
100000000024	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	321000	320000	019f59d0-766b-708b-bf3f-6d55e1232c89	9397000	9398000	1000	0	SUCCESS		019fdc53-9e79-774a-bacb-34499041060e	2026-08-07 20:04:58.549135+07	2026-08-07 20:04:58.549135+07	\N
100000000025	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	320000	310000	019f59d0-766b-708b-bf3f-6d55e1232c89	9398000	9408000	10000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc54-1e2b-7139-b77d-c3a896e9ba67	2026-08-07 20:05:32.323188+07	2026-08-07 20:05:32.323188+07	\N
100000000026	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	310000	300000	019f59d0-766b-708b-bf3f-6d55e1232c89	9408000	9418000	10000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc57-7092-76d4-91fa-48508ebe044a	2026-08-07 20:09:09.389107+07	2026-08-07 20:09:09.389107+07	\N
100000000027	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9418000	9417000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	300000	301000	1000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdc57-d943-7ea3-8b5f-5749cf0e48a1	2026-08-07 20:09:35.89973+07	2026-08-07 20:09:35.89973+07	\N
100000000028	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9417000	9416000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	301000	302000	1000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdc58-e9bf-7faf-ad31-4c0d2ce8d87b	2026-08-07 20:10:45.295949+07	2026-08-07 20:10:45.295949+07	\N
100000000029	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9416000	9406000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	302000	312000	10000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc59-c826-71b5-a7eb-5dde0cc7a3dc	2026-08-07 20:11:42.366502+07	2026-08-07 20:11:42.366502+07	\N
100000000030	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	312000	311000	019f59d0-766b-708b-bf3f-6d55e1232c89	9406000	9407000	1000	0	SUCCESS		019fdc5a-a65d-75b4-8ca9-545f4c527816	2026-08-07 20:12:39.091479+07	2026-08-07 20:12:39.091479+07	\N
100000000031	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	311000	301000	019f59d0-766b-708b-bf3f-6d55e1232c89	9407000	9417000	10000	0	SUCCESS		019fdc5a-e42b-7a86-86b9-0c291a1a5e8d	2026-08-07 20:12:56.67102+07	2026-08-07 20:12:56.67102+07	\N
100000000032	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	301000	291000	019f59d0-766b-708b-bf3f-6d55e1232c89	9417000	9427000	10000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc5d-4b65-7999-adc4-67ecd807f2db	2026-08-07 20:15:35.164632+07	2026-08-07 20:15:35.164632+07	\N
100000000033	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	291000	191000	019f59d0-766b-708b-bf3f-6d55e1232c89	9427000	9527000	100000	0	SUCCESS		019fdc5d-e49f-7bea-a5b5-f974aef3f671	2026-08-07 20:16:13.057833+07	2026-08-07 20:16:13.057833+07	\N
100000000034	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	191000	190000	019f59d0-766b-708b-bf3f-6d55e1232c89	9527000	9528000	1000	0	SUCCESS		019fdc61-d68c-7936-bb26-31c8e1ccff94	2026-08-07 20:20:30.749358+07	2026-08-07 20:20:30.749358+07	\N
100000000035	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	190000	189000	019f59d0-766b-708b-bf3f-6d55e1232c89	9528000	9529000	1000	0	SUCCESS		019fdc62-b264-7f3c-97f8-3c3072e1d5f1	2026-08-07 20:21:26.554573+07	2026-08-07 20:21:26.554573+07	\N
100000000036	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	189000	188000	019f59d0-766b-708b-bf3f-6d55e1232c89	9529000	9530000	1000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc64-895f-7bc2-8450-661703cf4161	2026-08-07 20:23:27.38472+07	2026-08-07 20:23:27.38472+07	\N
100000000037	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9530000	9520000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	188000	198000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	019fdc68-0dd6-7d5a-a711-ff2f6e79d89f	2026-08-07 20:27:19.231252+07	2026-08-07 20:27:19.231252+07	\N
100000000038	TRANSFER	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	198000	188000	019f59d0-766b-708b-bf3f-6d55e1232c89	9520000	9530000	10000	0	SUCCESS	 Mình chuyển tiền nhé 💵	019fdc6d-e760-798a-aeb2-d5ab30365096	2026-08-07 20:33:44.313928+07	2026-08-07 20:33:44.313928+07	\N
100000000039	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9530000	9520000	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	188000	198000	10000	0	SUCCESS		01a01a01-cf42-7bee-b333-e29b31f40b4b	2026-08-19 19:32:04.605939+07	2026-08-19 19:32:04.605939+07	\N
100000000040	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9520000	9586666	\N	\N	\N	66666	0	SUCCESS	\N	01a01f83-8ad4-791f-9dee-b44fa6a7ef3f	2026-08-20 21:23:03.036422+07	2026-08-20 21:23:03.036422+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000041	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9586666	9593332	\N	\N	\N	6666	0	SUCCESS	\N	01a01f90-9a95-7c9c-8c1a-8de293e307e0	2026-08-20 21:26:08.697215+07	2026-08-20 21:26:08.697215+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000043	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9593332	9599998	\N	\N	\N	6666	0	SUCCESS	\N	01a01f92-239c-7f29-bbf3-a52acfb5ac50	2026-08-20 21:27:48.720104+07	2026-08-20 21:27:48.720104+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000044	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9599998	9606664	\N	\N	\N	6666	0	SUCCESS	\N	01a024a0-b2c8-7218-b2a3-8835b83552ea	2026-08-21 21:01:50.699289+07	2026-08-21 21:01:50.699289+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000045	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9606664	9673330	\N	\N	\N	66666	0	SUCCESS	\N	01a024a0-f1ff-731d-92a8-ecaa5fee83e9	2026-08-21 21:07:57.786444+07	2026-08-21 21:07:57.786444+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000046	WITHDRAW	019f59d0-766b-708b-bf3f-6d55e1232c89	9673330	9606664	\N	\N	\N	66666	0	SUCCESS	\N	01a024af-b0b2-70c8-8160-b74cfd2fc835	2026-08-21 21:18:13.479895+07	2026-08-21 21:18:13.479895+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000047	WITHDRAW	019f59d0-766b-708b-bf3f-6d55e1232c89	9606664	9506664	\N	\N	\N	100000	0	SUCCESS	\N	01a024af-efc2-7a02-819f-4aa6982e3f6b	2026-08-21 21:18:27.997342+07	2026-08-21 21:18:27.997342+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000048	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9506664	9573330	\N	\N	\N	66666	0	SUCCESS	\N	01a024b0-252f-76d2-8c4f-6298bdecde39	2026-08-21 21:18:44.260602+07	2026-08-21 21:18:44.260602+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000049	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9573330	9639996	\N	\N	\N	66666	0	SUCCESS	\N	01a02ee5-1b96-7c1c-9907-c1d913cbeaf7	2026-08-23 20:53:12.771061+07	2026-08-23 20:53:12.771061+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000050	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9639996	9629996	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	198000	208000	10000	0	SUCCESS		01a02eed-cbe6-7e95-af36-b4b645d84a71	2026-08-23 21:02:32.022785+07	2026-08-23 21:02:32.022785+07	\N
100000000051	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9629996	9619996	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	208000	218000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	01a02ef2-b700-75e7-885f-969427f3a227	2026-08-23 21:07:39.115948+07	2026-08-23 21:07:39.115948+07	\N
100000000052	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9619996	9613330	019f4b7a-1ef3-736c-ba4e-077b9ce03b11	282000	288666	6666	0	SUCCESS		01a02ef4-7b61-7c94-886d-b1336901e2ed	2026-08-23 21:09:33.325186+07	2026-08-23 21:09:33.325186+07	\N
100000000053	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9613330	9603330	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	218000	228000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	01a02ef5-9205-7c08-9c52-13fc78300e66	2026-08-23 21:10:43.540258+07	2026-08-23 21:10:43.540258+07	\N
100000000054	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9603330	9593330	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	228000	238000	10000	0	SUCCESS		01a02ef5-b325-7cdb-ac66-3afd24640767	2026-08-23 21:10:51.76468+07	2026-08-23 21:10:51.76468+07	\N
100000000055	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9593330	9583330	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	238000	248000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	01a02ef6-dca1-7fcb-917a-3064e6566e0d	2026-08-23 21:12:08.185797+07	2026-08-23 21:12:08.185797+07	\N
100000000056	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	9583330	9573330	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	248000	258000	10000	0	SUCCESS	 Cảm ơn nha 👍🫰	01a04152-8a4a-7cb4-b219-22a5bba06a9e	2026-08-27 10:45:31.200582+07	2026-08-27 10:45:31.200582+07	\N
100000000057	WITHDRAW	019f59d0-766b-708b-bf3f-6d55e1232c89	9573330	9506664	\N	\N	\N	66666	0	SUCCESS	\N	01a04152-f4b6-79f7-867b-85b9f4df0d1c	2026-08-27 10:46:01.439473+07	2026-08-27 10:46:01.439473+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000058	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	9506664	10173330	\N	\N	\N	666666	0	SUCCESS	\N	01a04192-a796-7705-a388-669c16762b34	2026-08-27 11:55:33.372051+07	2026-08-27 11:55:33.372051+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000059	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	10173330	10176330	\N	\N	\N	3000	0	SUCCESS	\N	01a04196-bd45-7b50-88ce-636cff9a155a	2026-08-27 11:59:58.101782+07	2026-08-27 11:59:58.101782+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000060	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	10176330	10177330	\N	\N	\N	1000	0	SUCCESS	\N	01a04196-f32c-7af1-94f6-c545842b6ee5	2026-08-27 12:00:10.450272+07	2026-08-27 12:00:10.450272+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000061	WITHDRAW	019f59d0-766b-708b-bf3f-6d55e1232c89	10177330	10110664	\N	\N	\N	66666	0	SUCCESS	\N	01a04197-29bb-7d11-a1be-8d03c5ca64a9	2026-08-27 12:00:24.843298+07	2026-08-27 12:00:24.843298+07	01a01014-f7ca-7531-88b6-ee74f95f642e
100000000062	TOPUP	019f59d0-766b-708b-bf3f-6d55e1232c89	10110664	10117330	\N	\N	\N	6666	0	SUCCESS	\N	01a04199-efad-73fd-bbba-0026f0fefb9c	2026-08-27 12:03:25.520242+07	2026-08-27 12:03:25.520242+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000063	TRANSFER	019f59d0-766b-708b-bf3f-6d55e1232c89	10117330	10017330	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	258000	358000	100000	0	SUCCESS	 Cảm ơn nha 👍🫰	01a12934-9e7c-7531-9aa9-42b0245b8efd	2026-10-11 11:25:36.266613+07	2026-10-11 11:25:36.266613+07	\N
100000000064	PAYMENT	019f59d0-766b-708b-bf3f-6d55e1232c89	10017330	9950664	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	358000	424666	66666	0	SUCCESS	hhhh	01a12936-0e8d-7b9e-ba29-1bdb457b36a4	2026-10-11 11:27:08.585133+07	2026-10-11 11:27:08.585133+07	\N
100000000065	WITHDRAW	019f59d0-766b-708b-bf3f-6d55e1232c89	9950664	9883998	\N	\N	\N	66666	0	SUCCESS	\N	01a1294a-a918-74af-a4e9-38e28c41a345	2026-10-11 11:49:57.426587+07	2026-10-11 11:49:57.426587+07	01a01a2d-7ec0-7d75-a9cd-21d5496e8202
100000000066	TOPUP	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	424666	491332	\N	\N	\N	66666	0	SUCCESS	\N	01a13415-9fff-7a74-8c9b-98c50d721128	2026-10-13 14:06:39.469338+07	2026-10-13 14:06:39.469338+07	01a1294a-df66-7304-ad9e-5e1e9266641e
100000000067	TOPUP	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	491332	691332	\N	\N	\N	200000	0	SUCCESS	\N	01a1341e-9284-7370-b127-1d025d1318bb	2026-10-13 14:16:30.188962+07	2026-10-13 14:16:30.188962+07	01a1341e-721e-703a-ab28-df64a9b85e9e
100000000068	WITHDRAW	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	691332	24666	\N	\N	\N	666666	0	SUCCESS	\N	01a13423-8f29-7798-8bb3-3087e546a024	2026-10-13 14:21:50.983636+07	2026-10-13 14:21:50.983636+07	01a1341e-721e-703a-ab28-df64a9b85e9e
\.


--
-- TOC entry 5037 (class 0 OID 16452)
-- Dependencies: 225
-- Data for Name: user_kyc; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_kyc (id, user_id, dob, gender, address, front_image_url, back_image_url, status, face_match_score, created_at, updated_at, face_image_url) FROM stdin;
080205015346	019f59d0-766b-708b-bf3f-6d55e1232c89	\N	\N	\N	D:\\project\\api\\images\\front-id\\019f59d0-766b-708b-bf3f-6d55e1232c89_1787755910400.jpg	D:\\project\\api\\images\\back-id\\019f59d0-766b-708b-bf3f-6d55e1232c89_1787755911079.jpg	APPROVED	88.89	2026-08-26 21:51:59.037568+07	2026-08-26 21:51:59.037568+07	D:\\project\\api\\images\\face\\019f59d0-766b-708b-bf3f-6d55e1232c89_1787755911348.jpg
080205015347	019f4b7a-1ef3-736c-ba4e-077b9ce03b59	\N	\N	\N	\N	\N	\N	\N	2026-10-11 11:10:01.872604+07	2026-10-11 11:10:01.872604+07	\N
0676756756756	01a13fd2-678f-7cd9-a5ef-38b146c8a8ee	\N	\N	\N	\N	\N	\N	\N	2026-10-15 20:48:49.848375+07	2026-10-15 20:48:49.848375+07	\N
\.


--
-- TOC entry 5038 (class 0 OID 16459)
-- Dependencies: 226
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, role, full_name, email, phone, password_hash, status, created_at, updated_at, failed_login_attempts, locked_until, refresh_token, pin_hash, phone_hash, fcm_token, static_qr_token, balance, api_key, call_back_url) FROM stdin;
019f4b7a-1ef3-736c-ba4e-077b9ce03b59	USER	Dương Gian	thongpvt003@gmail.com	0332330072	$2b$10$pcBWxcNgL1zpjqin3yQGhO7w.h05DO0z2oIG9Fn6/4JGaypbIz5YO	ACTIVE	2026-07-27 03:39:33.116574	2026-07-27 03:39:33.116574	0	\N	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDE5ZjRiN2EtMWVmMy03MzZjLWJhNGUtMDc3YjljZTAzYjU5IiwicGhvbmUiOiIwMzMyMzMwMDcyIiwiZnVsbF9uYW1lIjoiRMawxqFuZyBHaWFuIiwidHlwZSI6IlVTRVIiLCJpYXQiOjE3OTE4OTU1ODIsImV4cCI6MTc5MjUwMDM4Mn0.x82A72yXm3pkTkmgbE2qUoqCbVKZp-dRL_DCHD5n2qE	$2b$10$zXW6H3jeqp8jftrNPlzV8OEo/HVUWu.RVnu.utuYrjPZpAWIoh3Cq	18fde8ab33f3aefe8685be8ac5c30a4ec1ebeff76c133161c69eb1d236423043	caC9EZRrTtefM0VJP7CCVp:APA91bFz9HesRV2qzOfuz7s73Ihr8zw92-B8UC0CwXwhQHBcAK6ODJTnNbryQQarM4NeOLGpmMQYahrvhHFF3Waj-Koixb7Q3ZMqVt03BSMF5dxzRPsKlXI	Mio:SWMdhEfRuQVsdswP	24666	\N	\N
01a04209-5d51-7cd6-b912-f2ad8e399324	USER	Liễu Như Yên	thongpvt003@gmail.com	0888888888	$2b$10$qrGZWmYsfIpHbW8mw4/Fluzmw9oem5XoQKSVG/xitykA9i/QfEQJe	ACTIVE	2026-08-27 14:05:05.154095	2026-08-27 14:05:05.154095	0	\N	\N	\N	535a4b9000766a518f99d6b90c216c401415abf5c62877caac2a8c3d19896595	\N	\N	0	\N	\N
01a0420b-52e2-7ae5-b332-a88af8dc6a51	USER	Ninh Thu Thủy	thongpvt003@gmail.com	0866666666	$2b$10$9qcrWlX.Jv00AStRAzx/EOZobgNZJZxefB0YQe9x8/fZI2ZO3ZEJi	ACTIVE	2026-08-27 14:07:13.552788	2026-08-27 14:07:13.552788	0	\N	\N	\N	170adb57fcfb04cccab7bccb34da69d97137238c9ae4d6684fe7ade96920731b	\N	\N	0	\N	\N
01a0420e-00d8-716c-86c6-fdbca7a2e38c	USER	Lý Thiên Đế	thongpvt003@gmail.com	0877777777	$2b$10$fNAuoLkTIRZIy83TtdHNCOy4NVfjuUM.va.ZrgYsjJQf9J/1pqeGi	ACTIVE	2026-08-27 14:10:09.15781	2026-08-27 14:10:09.15781	0	\N	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDFhMDQyMGUtMDBkOC03MTZjLTg2YzYtZmRiY2E3YTJlMzhjIiwicGhvbmUiOiIwODc3Nzc3Nzc3IiwiZnVsbF9uYW1lIjpudWxsLCJ3YWxsZXRfaWQiOiIwMWEwNDIwZS0wMGQ4LTcxNmMtODZjNi1mZGJkZmQ3MTUxMmIiLCJpYXQiOjE3ODc4MTUyNzEsImV4cCI6MTc4ODQyMDA3MX0.SFHmOxh89Ja2b0JKm4R7UNRNw5hFiGctQiM1VQHSur4	\N	c4c00ae68b25db997e081c5cf754dce5f7f3c19385c42e494ff8e49296652bd9	cn8tiKWlQ9KrX2Jps0_IcA:APA91bHqo_c63CoU3KfuqflmY5UTnGBSBvKh5p6L_D0DMbCXK0cH0xXwfWjOhfGt9ToZmz4DhlAU3Bwsn-wG2jBMZmBBpO0D0np8em4VvCMnPR6-bC0QOAE	\N	0	\N	\N
019f4b7a-1ef3-736c-ba4e-077b9ce03b11	USER	Lý Lạc Bình	thongpvt003@gmail.com	0982314632	$2b$10$pcBWxcNgL1zpjqin3yQGhO7w.h05DO0z2oIG9Fn6/4JGaypbIz5YO	ACTIVE	2026-07-27 03:40:32.677175	2026-07-27 03:40:32.677175	0	\N	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDE5ZjRiN2EtMWVmMy03MzZjLWJhNGUtMDc3YjljZTAzYjExIiwicGhvbmUiOiIwOTgyMzE0NjMyIiwiZnVsbF9uYW1lIjoiTMO9IEzhuqFjIELDrG5oIiwid2FsbGV0X2lkIjoiMDE5ZjRiN2EtMWVmMy03MzZjLWJhNGUtMDc3YjljZTAzYjU1IiwiaWF0IjoxNzkxNjkyMzE1LCJleHAiOjE3OTIyOTcxMTV9.PPWY3ayzAF_hnRc3mvZrvH1qaJjru-wU9ssp-kuvYKg	\N	1baf1b3830b22719a93d2defcbabfec20c137fac2e145adb327a10b0f3f2cf5f	cn8tiKWlQ9KrX2Jps0_IcA:APA91bHqo_c63CoU3KfuqflmY5UTnGBSBvKh5p6L_D0DMbCXK0cH0xXwfWjOhfGt9ToZmz4DhlAU3Bwsn-wG2jBMZmBBpO0D0np8em4VvCMnPR6-bC0QOAE	\N	288666	\N	\N
01a133fd-c78f-7a79-abd6-eb46c5ce2623	USER	\N	thongpvt003@gmail.com	0866566655	$2b$10$lCi2l2nE3HgsJNdAgFwFPuValiRhaxXv.Oz6An0bsRp0fT20DaQhi	ACTIVE	2026-10-13 13:40:44.276165	2026-10-13 13:40:44.276165	0	\N	\N	\N	c2b4b17be7bba8f9956e92d434ed7c6654bb118e31cee5d6249817bc3c52f67d	\N	\N	0	\N	\N
01a13429-0876-7fde-a87a-5bcaefa69097	USER	\N	thongpvt002@gmail.com	0855555555	$2b$10$rNE4MNTQqirkH3fALZ6h4.jODR50mXHJJLS102TG9uJfZ2r0Y9gsS	ACTIVE	2026-10-13 14:28:40.633412	2026-10-13 14:28:40.633412	0	\N	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDFhMTM0MjktMDg3Ni03ZmRlLWE4N2EtNWJjYWVmYTY5MDk3IiwicGhvbmUiOiIwODU1NTU1NTU1IiwiZnVsbF9uYW1lIjpudWxsLCJpYXQiOjE3OTE4OTQ4MzQsImV4cCI6MTc5MjQ5OTYzNH0.DteKaTS-I84F3dVAtlRghT_Q-dlpwEBeZkriIG2ZMzU	\N	fa8da95cb5e7c9f0c1f79d948419f7537bba03ec46ae32b0925de8573763e95a	cn8tiKWlQ9KrX2Jps0_IcA:APA91bHqo_c63CoU3KfuqflmY5UTnGBSBvKh5p6L_D0DMbCXK0cH0xXwfWjOhfGt9ToZmz4DhlAU3Bwsn-wG2jBMZmBBpO0D0np8em4VvCMnPR6-bC0QOAE	\N	0	\N	\N
019f59d0-766b-708b-bf3f-6d55e1232c89	USER	Phan Văn Thống	thongpvt003@gmail.com	0855313436	$2b$10$pcBWxcNgL1zpjqin3yQGhO7w.h05DO0z2oIG9Fn6/4JGaypbIz5YO	ACTIVE	2026-07-24 14:41:24.869744	2026-07-24 14:41:24.869744	0	\N	\N	$2b$10$3YHnqRqTm8z4RPcgvZDtOOG777xd0dPXkiuKEMSZ.vtqATmd1o17q	16eedbd53e72c6cc3366102f24bf8ebcdf38448713be0c4265ce702a72f48587	\N	Mio:cEBaoiBjABCcP79G	9883998	\N	\N
01a13fd2-678f-7cd9-a5ef-38b146c8a8ee	MERCHANT	r	thongpvt004@gmail.com	0956755544	$2b$10$ZA.0S3ThsXQjPyGUxCxeNuGJ8.ZJtROEluO7yPBQXixaciILaMKjK	ACTIVE	2026-10-15 20:48:49.848375	2026-10-15 20:48:49.848375	0	\N	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDFhMTNmZDItNjc4Zi03Y2Q5LWE1ZWYtMzhiMTQ2YzhhOGVlIiwicGhvbmUiOiIwOTU2NzU1NTQ0IiwiZnVsbF9uYW1lIjoiciIsInR5cGUiOiJNRVJDSEFOVCIsImlhdCI6MTc5MjA3MjQwNCwiZXhwIjoxNzkyNjc3MjA0fQ.K0DPfzk7ht_6XBFjFJi9oJh-1LDS_IaNepgzTIQY4L0	\N	00d498ca3844dc26aad10d95e6bb0b9bbdbe56ff355590cd01101ca9f7428703	\N	\N	0	{}	http://127
01a04208-1997-7330-be30-04f8afb24fb0	USER	Trần Mạc	thongpvt003@gmail.com	0855313437	$2b$10$1jM2ftjejJHkWhtO4Zy.iu0cXV.I/09WHBHkUYTOiuvLEVG6/eLvK	ACTIVE	2026-08-27 14:03:42.282245	2026-08-27 14:03:42.282245	0	\N	\N	\N	16eedbd53e72c6cc3366102f24bf8ebcdf38448713be0c4265ce702a72f48587	\N	\N	0	\N	\N
04c78791-4622-4b41-a1bf-9a3beb3aeb04	ADMIN	Administrator	admin@ewallet.com	undefined	$2a$10$L1y.XojQQaCab9uvlRxrUOTty0gejdIOlhEpK4/OVlnhtCMJAbnui	ACTIVE	2026-10-17 22:11:33.558266	2026-10-17 22:11:33.558266	0	\N	\N	\N	\N	\N	\N	0	\N	\N
\.


--
-- TOC entry 5045 (class 0 OID 0)
-- Dependencies: 223
-- Name: transaction_ref_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.transaction_ref_seq', 100000000068, true);


--
-- TOC entry 4845 (class 2606 OID 16473)
-- Name: banks banks_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_code_key UNIQUE (code);


--
-- TOC entry 4847 (class 2606 OID 16475)
-- Name: banks banks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);


--
-- TOC entry 4849 (class 2606 OID 16477)
-- Name: idempotency_keys idempotency_new_pkey1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_new_pkey1 PRIMARY KEY (idempotency_key);


--
-- TOC entry 4851 (class 2606 OID 16479)
-- Name: linked_bank_accounts linked_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.linked_bank_accounts
    ADD CONSTRAINT linked_bank_accounts_pkey PRIMARY KEY (id);


--
-- TOC entry 4853 (class 2606 OID 16481)
-- Name: otp_tracking otp_tracking_phone_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.otp_tracking
    ADD CONSTRAINT otp_tracking_phone_key UNIQUE (phone);


--
-- TOC entry 4855 (class 2606 OID 16483)
-- Name: otp_tracking otp_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.otp_tracking
    ADD CONSTRAINT otp_tracking_pkey PRIMARY KEY (id);


--
-- TOC entry 4859 (class 2606 OID 16485)
-- Name: payment_requests payment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_pkey PRIMARY KEY (id);


--
-- TOC entry 4861 (class 2606 OID 16487)
-- Name: payment_requests payment_requests_reference_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT payment_requests_reference_code_key UNIQUE (reference_code);


--
-- TOC entry 4866 (class 2606 OID 16489)
-- Name: transactions transactions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- TOC entry 4868 (class 2606 OID 16491)
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- TOC entry 4873 (class 2606 OID 16493)
-- Name: users uk_users_phone; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uk_users_phone UNIQUE (phone);


--
-- TOC entry 4870 (class 2606 OID 16495)
-- Name: user_kyc user_kyc_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_kyc
    ADD CONSTRAINT user_kyc_pkey PRIMARY KEY (id);


--
-- TOC entry 4875 (class 2606 OID 16497)
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- TOC entry 4877 (class 2606 OID 16499)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4856 (class 1259 OID 16500)
-- Name: idx_payment_requests_destination_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_requests_destination_user ON public.payment_requests USING btree (destination_user_id);


--
-- TOC entry 4857 (class 1259 OID 16501)
-- Name: idx_payment_requests_reference_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_requests_reference_code ON public.payment_requests USING btree (reference_code);


--
-- TOC entry 4862 (class 1259 OID 16502)
-- Name: idx_transactions_dest_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transactions_dest_time ON public.transactions USING btree (destination_user_id, created_at DESC);


--
-- TOC entry 4863 (class 1259 OID 16503)
-- Name: idx_transactions_source_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transactions_source_time ON public.transactions USING btree (source_user_id, created_at DESC);


--
-- TOC entry 4864 (class 1259 OID 16504)
-- Name: idx_transactions_type_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transactions_type_status ON public.transactions USING btree (transaction_type, status);


--
-- TOC entry 4871 (class 1259 OID 16505)
-- Name: idx_users_phone_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_phone_hash ON public.users USING btree (phone_hash);


--
-- TOC entry 4878 (class 2606 OID 16506)
-- Name: linked_bank_accounts fk_linked_bank_accounts_bank; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.linked_bank_accounts
    ADD CONSTRAINT fk_linked_bank_accounts_bank FOREIGN KEY (bank_id) REFERENCES public.banks(id);


--
-- TOC entry 4879 (class 2606 OID 16511)
-- Name: linked_bank_accounts fk_linked_bank_accounts_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.linked_bank_accounts
    ADD CONSTRAINT fk_linked_bank_accounts_user FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 4880 (class 2606 OID 16516)
-- Name: payment_requests fk_payment_requests_destination_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT fk_payment_requests_destination_user FOREIGN KEY (destination_user_id) REFERENCES public.users(id);


--
-- TOC entry 4881 (class 2606 OID 16521)
-- Name: payment_requests fk_payment_requests_source_user; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT fk_payment_requests_source_user FOREIGN KEY (source_user_id) REFERENCES public.users(id);


--
-- TOC entry 4882 (class 2606 OID 16526)
-- Name: payment_requests fk_payment_requests_transaction; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_requests
    ADD CONSTRAINT fk_payment_requests_transaction FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- TOC entry 4883 (class 2606 OID 16531)
-- Name: transactions fk_transactions_linked_bank_account; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT fk_transactions_linked_bank_account FOREIGN KEY (linked_bank_account_id) REFERENCES public.linked_bank_accounts(id);


--
-- TOC entry 4884 (class 2606 OID 16536)
-- Name: user_kyc fk_user_kyc_users; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_kyc
    ADD CONSTRAINT fk_user_kyc_users FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


-- Completed on 2026-10-18 10:58:26

--
-- PostgreSQL database dump complete
--

\unrestrict er2bjdaPcTIQwBnttLjIndIfdm0nDZgHJPCIsgICUxcxTktcQuu2AXAChoFeVgs

