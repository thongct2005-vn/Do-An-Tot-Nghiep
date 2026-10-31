/* =====================================================================
 * dashboard/guide.js - Tab "Hướng dẫn tích hợp"
 * ===================================================================== */

registerTab('guide', {
    html: `
                    <section id="g-flow" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-1">Luồng thanh toán QR</h2>
                        <p class="text-sm text-gray-600 mb-4">Hệ thống của bạn chỉ làm việc với cổng thanh toán. Việc trừ tiền ví người dùng do backend ví xử lý.</p>
                        <p class="text-sm text-gray-600 mb-4">Ngoài cách tự hiển thị QR trên website của bạn, bạn có thể chuyển khách sang trang thanh toán do cổng cung cấp. Xem mục <a href="#g-redirect" class="text-blue-600 hover:underline">Luồng Redirect</a>.</p>
                        <ol class="space-y-3 text-sm">
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</span>
                                <span>Khách đặt hàng. Server của bạn gọi API <b>tạo thanh toán</b> với <code class="text-blue-700">order_id</code> và <code class="text-blue-700">amount</code>.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">2</span>
                                <span>Cổng thanh toán trả về <b>mã QR</b> (trường <code class="text-blue-700">qr_image</code>). Bạn hiển thị QR này cho khách.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">3</span>
                                <span>Khách mở app ví, quét QR, xem số tiền và nội dung, rồi xác nhận thanh toán.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">4</span>
                                <span>Backend ví kiểm tra số dư, trừ tiền và ghi giao dịch.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">5</span>
                                <span>Cổng thanh toán gửi <b>callback</b> (có chữ ký) về Callback URL của bạn.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">6</span>
                                <span>Bạn xác minh chữ ký, cập nhật trạng thái đơn hàng và trả về HTTP 2xx (ví dụ 200).</span></li>
                        </ol>
                    </section>

                    <section id="g-prepare" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-3">Chuẩn bị</h2>
                        <ul class="list-disc pl-5 space-y-2 text-sm text-gray-700">
                            <li>Lấy <b>API Key</b> và <b>Secret Key</b> ở tab Tổng quan, lưu vào biến môi trường trên server của bạn (<code>WALLET_API_KEY</code>, <code>WALLET_SECRET_KEY</code>).</li>
                            <li>Đặt <b>Callback URL</b> là địa chỉ công khai, chạy HTTPS, nhận được request POST.</li>
                            <li>Base URL của API: <code id="guide-base-url" class="bg-gray-100 px-2 py-0.5 rounded text-xs break-all"></code></li>
                            <li>Mọi lời gọi API phải chạy từ <b>server</b> của bạn, không gọi trực tiếp từ trình duyệt hay app.</li>
                        </ul>
                    </section>

                    <section id="g-auth" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-1">Xác thực và chữ ký</h2>
                        <p class="text-sm text-gray-600 mb-4">Mỗi request gửi lên cổng thanh toán cần các header sau:</p>
                        <div class="overflow-x-auto">
                            <table class="w-full text-sm text-left">
                                <thead class="text-gray-500 border-b">
                                    <tr><th class="py-2 pr-4 font-medium">Header</th><th class="py-2 font-medium">Ý nghĩa</th></tr>
                                </thead>
                                <tbody class="divide-y">
                                    <tr><td class="py-2 pr-4 font-mono text-xs text-blue-700 whitespace-nowrap">X-API-Key</td><td class="py-2">API Key của merchant, dùng để định danh.</td></tr>
                                    <tr><td class="py-2 pr-4 font-mono text-xs text-blue-700 whitespace-nowrap">X-Timestamp</td><td class="py-2">Thời gian gửi (Unix giây). Request quá cũ sẽ bị từ chối.</td></tr>
                                    <tr><td class="py-2 pr-4 font-mono text-xs text-blue-700 whitespace-nowrap">X-Signature</td><td class="py-2">Chữ ký HMAC-SHA256 (hex) của <code>timestamp + "." + body</code>, ký bằng <b>Secret Key</b>. Secret Key không được gửi đi.</td></tr>
                                    <tr><td class="py-2 pr-4 font-mono text-xs text-blue-700 whitespace-nowrap">Idempotency-Key</td><td class="py-2">Chuỗi duy nhất cho mỗi lần tạo thanh toán. Gửi lại cùng key sẽ không tạo giao dịch thứ hai.</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <p class="text-sm text-gray-600 mt-4 mb-2">Ví dụ tạo chữ ký (Node.js):</p>
                        <div class="relative">
                            <button type="button" onclick="copyCode('code-sign', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-sign"></code></pre>
                        </div>
                    </section>

                    <section id="g-create" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-1">Tạo thanh toán</h2>
                        <p class="text-sm text-gray-600 mb-4">
                            <span class="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded">POST</span>
                            <code id="ep-create" class="ml-1 text-xs break-all"></code>
                        </p>
                        <p class="text-sm text-gray-600 mb-2">Body:</p>
                        <div class="relative mb-4">
                            <button type="button" onclick="copyCode('code-create-body', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-create-body"></code></pre>
                        </div>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li><code class="text-blue-700">amount</code> (bắt buộc): số tiền (VND, số nguyên) từ 1.000 đến 50.000.000.</li>
                            <li><code class="text-blue-700">order_id</code> (bắt buộc): mã đơn hàng của bạn, mỗi đơn dùng một mã riêng, không trùng trong cùng merchant.</li>
                            <li><code class="text-blue-700">description</code> (không bắt buộc): nội dung thanh toán, tối đa 50 ký tự.</li>
                            <li><code class="text-blue-700">items</code> (không bắt buộc): danh sách sản phẩm của đơn hàng, tối đa 100 phần tử. Mỗi phần tử gồm:
                                <ul class="list-disc pl-5 mt-1 space-y-1">
                                    <li><code class="text-blue-700">product_id</code>: mã sản phẩm (chuỗi, tối đa 100 ký tự).</li>
                                    <li><code class="text-blue-700">name</code>: tên sản phẩm (tối đa 255 ký tự).</li>
                                    <li><code class="text-blue-700">quantity</code>: số lượng (số nguyên từ 1 đến 100000).</li>
                                    <li><code class="text-blue-700">unit_price</code>: đơn giá (VND, số nguyên không âm).</li>
                                    <li><code class="text-blue-700">description</code> (không bắt buộc): mô tả sản phẩm (tối đa 255 ký tự).</li>
                                </ul>
                            </li>
                            <li><code class="text-blue-700">callback_url</code>: nơi nhận kết quả (tối đa 100 ký tự). Nếu bỏ trống sẽ dùng Callback URL đã lưu ở tab Tổng quan. Yêu cầu của URL xem ở mục <b>Nhận callback</b>.</li>
                            <li><code class="text-blue-700">return_url</code> (không bắt buộc): trang của bạn để đưa khách quay lại sau khi thanh toán xong, dùng cho <a href="#g-redirect" class="text-blue-600 hover:underline">Luồng Redirect</a> (https, tối đa 255 ký tự, xem <b>Quy định của return_url</b>).</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Phản hồi thành công:</p>
                        <div class="relative mb-4">
                            <button type="button" onclick="copyCode('code-create-res', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-create-res"></code></pre>
                        </div>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li><code class="text-blue-700">id</code>: mã thanh toán. Chính là <code>payment_id</code> trong callback và trong API kiểm tra trạng thái.</li>
                            <li><code class="text-blue-700">qr_image</code>: ảnh QR dạng data URL (PNG base64), gán thẳng vào <code>&lt;img src&gt;</code> để khách quét.</li>
                            <li><code class="text-blue-700">payment_url</code>: địa chỉ trang thanh toán của cổng. Chuyển hướng khách tới đây nếu bạn dùng <a href="#g-redirect" class="text-blue-600 hover:underline">Luồng Redirect</a>.</li>
                            <li><code class="text-blue-700">return_url</code>: giá trị bạn đã gửi khi tạo (không gửi thì là <code>null</code>).</li>
                            <li><code class="text-blue-700">reference_code</code>: mã tham chiếu được mã hóa trong QR.</li>
                            <li><code class="text-blue-700">status</code>: trạng thái ban đầu của đơn, luôn là <code>PENDING</code>.</li>
                            <li><code class="text-blue-700">expires_at</code>: thời điểm mã QR hết hạn (mặc định 15 phút sau khi tạo).</li>
                            <li><code class="text-blue-700">items</code>: danh sách sản phẩm đã lưu cho đơn, là mảng rỗng nếu bạn không gửi <code>items</code>.</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Ví dụ gọi từ server (Node.js):</p>
                        <div class="relative">
                            <button type="button" onclick="copyCode('code-create-js', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-create-js"></code></pre>
                        </div>
                    </section>

                    <section id="g-redirect" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-1">Luồng Redirect</h2>
                        <p class="text-sm text-gray-600 mb-4">Thay vì tự hiển thị mã QR, bạn chuyển khách sang <b>trang thanh toán do cổng cung cấp</b>. Trang này hiển thị tên cửa hàng, số tiền, nội dung, mã QR và đồng hồ đếm ngược, tự cập nhật khi khách thanh toán xong rồi cho khách bấm quay về website của bạn. Bạn không cần dựng giao diện thanh toán.</p>
                        
                        <ol class="space-y-3 text-sm mb-5">
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</span>
                                <span>Khách bấm <b>Thanh toán</b> trên website. Server của bạn gọi API <b>tạo thanh toán</b>, gửi thêm <code class="text-blue-700">return_url</code> là trang của bạn để đón khách quay lại.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">2</span>
                                <span>Cổng trả về <code class="text-blue-700">payment_url</code>. Bạn lưu <code class="text-blue-700">id</code> cùng <code class="text-blue-700">order_id</code>, rồi <b>chuyển hướng</b> khách (HTTP 302 hoặc 303) tới <code class="text-blue-700">payment_url</code>.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">3</span>
                                <span>Khách xem số tiền trên trang của cổng, quét QR bằng app ví và xác nhận thanh toán. Mở trang trên máy tính rồi quét bằng điện thoại cũng được. Trang tự cập nhật, không cần tải lại.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">4</span>
                                <span>Backend ví trừ tiền và ghi giao dịch. Cổng gửi <b>callback</b> (có chữ ký) về Callback URL của bạn. Đây là nguồn xác nhận đáng tin cậy.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">5</span>
                                <span>Trang của cổng báo <b>thành công</b> hoặc <b>thất bại</b>, rồi hiện nút <b>Quay lại cửa hàng</b> cùng tên miền sẽ được mở. Cổng <b>không tự chuyển trang</b>, khách phải bấm nút. Khi bấm, khách được đưa về <code class="text-blue-700">return_url</code> kèm <code class="text-blue-700">order_id</code>, <code class="text-blue-700">payment_id</code>, <code class="text-blue-700">amount</code>, <code class="text-blue-700">status</code>, <code class="text-blue-700">paid_at</code>, <code class="text-blue-700">timestamp</code> và <code class="text-blue-700">signature</code>.</span></li>
                            <li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">6</span>
                                <span>Trang kết quả của bạn <b>kiểm tra chữ ký</b>, đối chiếu <code class="text-blue-700">order_id</code>, <code class="text-blue-700">payment_id</code> và <code class="text-blue-700">amount</code> với đơn trong hệ thống, rồi mới hiển thị kết quả cho khách. Nếu chữ ký sai, bỏ qua toàn bộ tham số.</span></li>
                        </ol>

                        <h3 class="text-sm font-bold mb-2">Quy định của return_url</h3>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li>Không bắt buộc. Bỏ trống thì sau khi có kết quả, trang của cổng chỉ báo &quot;Bạn có thể đóng trang này&quot; và không có nút quay về website của bạn.</li>
                            <li>Phải bắt đầu bằng <code>https://</code> (máy chủ chạy thật không nhận <code>http://</code>), tối đa 255 ký tự, không chứa tên đăng nhập hay mật khẩu, không trỏ về <code>localhost</code> hoặc địa chỉ IP nội bộ. Đơn vi phạm bị từ chối với lỗi 400.</li>
                            <li>Không đặt token, mã nội bộ hay thông tin nhạy cảm trong <code>return_url</code>. Cổng không trả lại URL gốc cho trình duyệt của khách trước khi có kết quả, nhưng URL sẽ xuất hiện trong lịch sử trình duyệt và log của bạn khi khách quay về.</li>
                            <li>Cổng thêm <code class="text-blue-700">order_id</code>, <code class="text-blue-700">payment_id</code>, <code class="text-blue-700">amount</code>, <code class="text-blue-700">status</code>, <code class="text-blue-700">paid_at</code> (chỉ khi đã thanh toán), <code class="text-blue-700">timestamp</code> và <code class="text-blue-700">signature</code> vào cuối URL. Các tham số khác của bạn được giữ nguyên, tham số trùng tên bị ghi đè. Ví dụ: <code class="break-all">https://yourdomain.com/checkout/result?order_id=ORD-20261017-001&amp;payment_id=0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b&amp;amount=150000&amp;status=success&amp;paid_at=2026-10-17T03:04:05.678Z&amp;timestamp=1792209845&amp;signature=9f2c...e1</code></li>
                        </ul>
                        <div class="overflow-x-auto mb-4">
                            <table class="w-full text-sm text-left">
                                <thead class="text-gray-500 border-b">
                                    <tr><th class="py-2 pr-4 font-medium">Giá trị status trên URL</th><th class="py-2 font-medium">Ý nghĩa</th></tr>
                                </thead>
                                <tbody class="divide-y">
                                    <tr><td class="py-2 pr-4"><span class="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded">success</span></td><td class="py-2">Khách đã thanh toán thành công.</td></tr>
                                    <tr><td class="py-2 pr-4"><span class="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded">failed</span></td><td class="py-2">Thanh toán thất bại, hoặc đơn hết hạn (mặc định 15 phút) mà khách chưa thanh toán.</td></tr>
                                </tbody>
                            </table>
                            <p class="text-xs text-gray-500 mt-2">Khi đơn còn <code>pending</code>, khách chưa bị chuyển đi, vẫn ở trang của cổng để thanh toán.</p>
                        </div>

                        <div class="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg p-3 text-sm space-y-1 mb-4">
                            <p><b>Phải kiểm tra <code>signature</code> trước khi tin các tham số trên URL.</b> Ai cũng có thể tự gõ <code>return_url?order_id=...&amp;status=success</code>, nhưng không ai ký giả được nếu không có Secret Key của bạn. Thiếu hoặc sai chữ ký thì bỏ qua toàn bộ request, không giao hàng.</p>
                            <p><b>Cách tính chữ ký</b> (cùng thuật toán với callback và hàm <code>sign</code> ở mục Ký request): <code class="break-all">signature = HMAC_SHA256_hex(secret_key, timestamp + &quot;.&quot; + data)</code>, trong đó <code class="break-all">data = payment_id|amount|status|paid_at|order_id</code>. Nếu URL không có <code>paid_at</code> thì dùng chuỗi rỗng. So sánh bằng hàm so sánh thời gian cố định (<code>timingSafeEqual</code>).</p>
                            <p>Sau khi chữ ký đúng, vẫn phải đối chiếu <code>order_id</code>, <code>payment_id</code> và <code>amount</code> với đơn của bạn, và kiểm tra <code>timestamp</code> còn mới.</p>
                            <p>Khách có thể đóng trình duyệt hoặc không bấm nút quay lại. Vì vậy vẫn phải cập nhật đơn bằng <b>callback</b>, đừng chỉ dựa vào trang <code>return_url</code>.</p>
                        </div>

                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li>Chuyển hướng <b>cả trang</b>. Trang thanh toán của cổng không cho nhúng trong <code>&lt;iframe&gt;</code>.</li>
                            <li>Mỗi <code>payment_url</code> ứng với một đơn và hết hạn theo <code>expires_at</code>. Khách làm trễ thì hãy tạo thanh toán mới.</li>
                            <li><code>payment_url</code> và <code>qr_image</code> cùng nằm trong một phản hồi, bạn chọn cách nào cũng được: tự hiển thị QR hoặc chuyển hướng sang <code>payment_url</code>.</li>
                        </ul>

                        <p class="text-sm text-gray-600 mb-2">Ví dụ phía server của bạn (Node.js, Express):</p>
                        <div class="relative">
                            <button type="button" onclick="copyCode('code-redirect-js', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-redirect-js"></code></pre>
                        </div>
                    </section>

                    <section id="g-callback" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-1">Nhận callback</h2>
                        <p class="text-sm text-gray-600 mb-4">
                            Khi giao dịch kết thúc, cổng thanh toán gửi
                            <span class="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded">POST</span>
                            tới Callback URL của bạn. Có hai trường hợp:
                        </p>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li><span class="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded">success</span> khi khách đã thanh toán và ví đã bị trừ tiền.</li>
                            <li><span class="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded">failed</span> khi đơn quá <code>expires_at</code> mà khách chưa thanh toán. Callback này có thể đến chậm tối đa khoảng 30 giây sau <code>expires_at</code>.</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Các header:</p>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li><code class="text-blue-700">X-Signature</code>: chữ ký HMAC-SHA256 của <code>timestamp + "." + rawBody</code>, ký bằng Secret Key của bạn.</li>
                            <li><code class="text-blue-700">X-Timestamp</code>: thời điểm gửi (giây Unix). Mỗi lần gửi lại có giá trị mới, nên bạn có thể từ chối callback lệch quá 5 phút.</li>
                            <li><code class="text-blue-700">X-Delivery-Id</code>: mã của lần gửi, <b>giữ nguyên qua các lần gửi lại</b>. Dùng để nhận biết callback trùng.</li>
                            <li><code class="text-blue-700">X-Delivery-Attempt</code>: lần gửi thứ mấy (1, 2, 3...).</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Body (JSON):</p>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li><code class="text-blue-700">payment_id</code>, <code class="text-blue-700">order_id</code>: mã thanh toán và mã đơn của bạn.</li>
                            <li><code class="text-blue-700">amount</code>: số tiền (VND), là <b>số nguyên</b>.</li>
                            <li><code class="text-blue-700">status</code>: <code>success</code> hoặc <code>failed</code>.</li>
                            <li><code class="text-blue-700">paid_at</code>: thời điểm thanh toán (ISO 8601, UTC). Là <code>null</code> khi <code>failed</code>.</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Ví dụ callback <code>success</code>:</p>
                        <div class="relative mb-4">
                            <button type="button" onclick="copyCode('code-callback-body', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-callback-body"></code></pre>
                        </div>
                        <p class="text-sm text-gray-600 mb-2">Ví dụ callback <code>failed</code>:</p>
                        <div class="relative mb-4">
                            <button type="button" onclick="copyCode('code-callback-body-failed', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-callback-body-failed"></code></pre>
                        </div>
                        <p class="text-sm text-gray-600 mb-2">Phản hồi và gửi lại:</p>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li>Trả về <b>HTTP 2xx</b> trong vòng vài giây (tối đa 8 giây) để báo đã nhận. Hãy xử lý nặng ở nền, đừng bắt cổng thanh toán chờ.</li>
                            <li>Mã khác 2xx, quá thời gian chờ, lỗi kết nối hoặc <b>redirect (3xx)</b> đều tính là gửi lỗi và sẽ được gửi lại. Cổng thanh toán không đi theo redirect.</li>
                            <li>Tối đa <b>8 lần gửi</b>: ngay lập tức, rồi sau 1 phút, 5 phút, 30 phút, 2 giờ, 6 giờ, 12 giờ và 24 giờ. Hết lượt mà vẫn lỗi thì dừng, hãy dùng API <b>Kiểm tra trạng thái</b> để đối soát.</li>
                            <li>Callback có thể đến <b>trùng</b> hoặc đến sau khi bạn đã tự tra cứu trạng thái. Xử lý phải idempotent (xem ví dụ bên dưới).</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Yêu cầu với Callback URL:</p>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li>Dùng <b>https</b> (môi trường production không chấp nhận http).</li>
                            <li>Tối đa 100 ký tự, không chứa tên đăng nhập và mật khẩu (<code>user:pass@</code>).</li>
                            <li>Phải là địa chỉ công khai. Không chấp nhận <code>localhost</code> hay IP nội bộ (<code>10.x</code>, <code>192.168.x</code>, <code>127.x</code>...). Khi phát triển trên máy cá nhân, hãy dùng dịch vụ tạo tunnel (ngrok, cloudflared...).</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Ví dụ xử lý (Node.js / Express):</p>
                        <div class="relative">
                            <button type="button" onclick="copyCode('code-callback-js', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-callback-js"></code></pre>
                        </div>
                    </section>

                    <section id="g-status" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-1">Kiểm tra trạng thái</h2>
                        <p class="text-sm text-gray-600 mb-2">
                            Dùng khi chưa nhận được callback hoặc cần đối soát.
                            <span class="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded ml-1">GET</span>
                            <code id="ep-status" class="ml-1 text-xs break-all"></code>
                        </p>
                        <p class="text-sm text-gray-600 mb-4">
                            Request GET không có body: vẫn gửi đủ <code class="text-blue-700">X-API-Key</code>, <code class="text-blue-700">X-Timestamp</code>, <code class="text-blue-700">X-Signature</code>, và ký với body rỗng, tức là <code>timestamp + "." + ""</code>. Không cần <code>Idempotency-Key</code>. Chỉ tra được đơn của chính merchant đang gọi.
                        </p>
                        <p class="text-sm text-gray-600 mb-2">Phản hồi thành công:</p>
                        <div class="relative mb-4">
                            <button type="button" onclick="copyCode('code-status-res', this)" class="absolute top-2 right-2 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Copy</button>
                            <pre class="code-block rounded-lg p-4 overflow-x-auto"><code id="code-status-res"></code></pre>
                        </div>
                        <ul class="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
                            <li><code class="text-blue-700">amount</code>: số tiền (VND, số nguyên).</li>
                            <li><code class="text-blue-700">transaction_id</code>, <code class="text-blue-700">paid_at</code>: chỉ có giá trị khi đơn đã thanh toán. Chưa thanh toán thì là <code>null</code>.</li>
                            <li><code class="text-blue-700">created_at</code>, <code class="text-blue-700">expires_at</code>: thời điểm tạo và thời điểm hết hạn của đơn (định dạng ISO 8601). Quá <code>expires_at</code> mà chưa thanh toán thì đơn chuyển sang <code>failed</code>.</li>
                        </ul>
                        <p class="text-sm text-gray-600 mb-2">Lỗi trả về dạng <code>{ "message": "..." }</code>. Không tìm thấy đơn (hoặc đơn không thuộc merchant) trả về HTTP 404.</p>
                        <div class="overflow-x-auto mt-4">
                            <table class="w-full text-sm text-left">
                                <thead class="text-gray-500 border-b">
                                    <tr><th class="py-2 pr-4 font-medium">Trạng thái</th><th class="py-2 font-medium">Ý nghĩa</th></tr>
                                </thead>
                                <tbody class="divide-y">
                                    <tr><td class="py-2 pr-4"><span class="bg-yellow-100 text-yellow-700 text-xs font-semibold px-2 py-0.5 rounded">pending</span></td><td class="py-2">Đã tạo, đang chờ khách thanh toán.</td></tr>
                                    <tr><td class="py-2 pr-4"><span class="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded">success</span></td><td class="py-2">Đã trừ tiền ví khách. Có thể giao hàng.</td></tr>
                                    <tr><td class="py-2 pr-4"><span class="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded">failed</span></td><td class="py-2">Thanh toán thất bại hoặc đơn đã hết hạn mà khách chưa thanh toán.</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section id="g-notes" class="guide-section bg-white rounded-2xl shadow p-6">
                        <h2 class="text-lg font-bold mb-3">Lưu ý quan trọng</h2>
                        <ul class="list-disc pl-5 space-y-2 text-sm text-gray-700">
                            <li><b>Luôn xác minh chữ ký</b> của callback trước khi cập nhật đơn. Chữ ký sai thì bỏ qua request.</li>
                            <li><b>Xử lý callback idempotent</b>: cùng một đơn có thể nhận callback nhiều lần. Đơn đã <code>success</code> thì không xử lý lại.</li>
                            <li>Trả về <b>HTTP 2xx</b> khi đã xử lý xong. Nếu hệ thống của bạn gặp lỗi tạm thời (ví dụ mất kết nối database), hãy trả <b>5xx</b> để cổng thanh toán gửi lại theo lịch ở mục Nhận callback. Đừng trả 2xx khi chưa lưu được kết quả.</li>
                            <li>Callback có hai loại: <code>success</code> và <code>failed</code>. Chỉ giao hàng khi nhận <code>success</code>, và hãy đối chiếu thêm bằng API <b>Kiểm tra trạng thái</b> nếu cần chắc chắn.</li>
                            <li>Đối chiếu <code>amount</code> (số nguyên) và <code>order_id</code> trong callback với đơn trong hệ thống của bạn. Dùng so sánh bằng (<code>===</code>) với số, đừng so với chuỗi.</li>
                            <li>Với <b>Luồng Redirect</b>, chỉ tin các tham số trên <code>return_url</code> sau khi <b>xác minh <code>signature</code></b> và đối chiếu <code>order_id</code>, <code>payment_id</code>, <code>amount</code> với đơn của bạn. Không có chữ ký hợp lệ thì dựa vào callback hoặc API Kiểm tra trạng thái.</li>
                            <li>Dùng <code>Idempotency-Key</code> khi tạo thanh toán để tránh tạo trùng nếu phải gửi lại do timeout.</li>
                            <li>Không để lộ API Key và Secret Key ở phía client. Lộ Secret Key thì người khác ký giả được request, hãy liên hệ để cấp lại.</li>
                        </ul>
                    </section>
    `,
    init() {
        renderGuide();
        initGuideSpy();
    },
});

        // Địa chỉ trang thanh toán của cổng (cùng máy chủ với API), dùng cho ví dụ Redirect
        const PAY_PAGE_BASE = new URL(GATEWAY_BASE).origin + '/pay/';

        const SAMPLES = {
            'code-sign':
"const crypto = require('crypto');\n" +
"\n" +
"const SECRET_KEY = process.env.WALLET_SECRET_KEY;\n" +
"\n" +
"function sign(timestamp, rawBody) {\n" +
"  return crypto\n" +
"    .createHmac('sha256', SECRET_KEY)\n" +
"    .update(timestamp + '.' + rawBody)\n" +
"    .digest('hex');\n" +
"}",

            'code-create-body':
'{\n' +
'  "amount": 150000,\n' +
'  "order_id": "ORD-20261017-001",\n' +
'  "description": "Thanh toan don ORD-20261017-001",\n' +
'  "items": [\n' +
'    {\n' +
'      "product_id": "SP001",\n' +
'      "name": "Áo thun nam",\n' +
'      "quantity": 2,\n' +
'      "unit_price": 50000,\n' +
'      "description": "Size L, màu đen"\n' +
'    },\n' +
'    {\n' +
'      "product_id": "SP002",\n' +
'      "name": "Quần jean",\n' +
'      "quantity": 1,\n' +
'      "unit_price": 50000,\n' +
'      "description": "Size 32"\n' +
'    }\n' +
'  ],\n' +
'  "callback_url": "https://yourdomain.com/api/payment/callback",\n' +
'  "return_url": "https://yourdomain.com/checkout/result"\n' +
'}',

            'code-create-res':
'{\n' +
'  "data": {\n' +
'    "id": "0193a1b2-7c4d-7e5f-8a9b-0c1d2e3f4a5b",\n' +
'    "reference_code": "A1B2C3D4E5F6G7H8",\n' +
'    "order_id": "ORD-20261017-001",\n' +
'    "amount": 150000,\n' +
'    "description": "Thanh toan don ORD-20261017-001",\n' +
'    "status": "PENDING",\n' +
'    "expires_at": "2026-10-17T09:43:00Z",\n' +
'    "created_at": "2026-10-17T09:28:00Z",\n' +
'    "items": [\n' +
'      {\n' +
'        "product_id": "SP001",\n' +
'        "name": "Áo thun nam",\n' +
'        "quantity": 2,\n' +
'        "unit_price": 50000,\n' +
'        "description": "Size L, màu đen"\n' +
'      },\n' +
'      {\n' +
'        "product_id": "SP002",\n' +
'        "name": "Quần jean",\n' +
'        "quantity": 1,\n' +
'        "unit_price": 50000,\n' +
'        "description": "Size 32"\n' +
'      }\n' +
'    ],\n' +
'    "qr_image": "data:image/png;base64,...",\n' +
'    "payment_url": "' + PAY_PAGE_BASE + 'A1B2C3D4E5F6G7H8",\n' +
'    "return_url": "https://yourdomain.com/checkout/result"\n' +
'  }\n' +
'}',

            'code-create-js':
"const crypto = require('crypto');\n" +
"\n" +
"async function createPayment(order) {\n" +
"  const body = JSON.stringify({\n" +
"    amount: order.amount,\n" +
"    order_id: order.id,\n" +
"    description: 'Thanh toan don ' + order.id,\n" +
"    items: order.items.map((i) => ({\n" +
"      product_id: String(i.id),\n" +
"      name: i.name,\n" +
"      quantity: i.qty,\n" +
"      unit_price: i.price,\n" +
"      description: i.description,\n" +
"    })),\n" +
"    callback_url: 'https://yourdomain.com/api/payment/callback',\n" +
"    return_url: 'https://yourdomain.com/checkout/result',\n" +
"  });\n" +
"  const timestamp = Math.floor(Date.now() / 1000).toString();\n" +
"\n" +
"  const res = await fetch('" + EP_CREATE_PAYMENT + "', {\n" +
"    method: 'POST',\n" +
"    headers: {\n" +
"      'Content-Type': 'application/json',\n" +
"      'X-API-Key': process.env.WALLET_API_KEY,\n" +
"      'X-Timestamp': timestamp,\n" +
"      'X-Signature': sign(timestamp, body),\n" +
"      'Idempotency-Key': 'create-' + order.id,\n" +
"    },\n" +
"    body,\n" +
"  });\n" +
"  const json = await res.json();\n" +
"  if (!res.ok) throw new Error(json.message);\n" +
"\n" +
"  return json.data;\n" +
"}",

            'code-redirect-js':
"// 1) Khách bấm \"Thanh toán\": tạo thanh toán rồi chuyển khách sang trang của cổng\n" +
"app.post('/checkout', async (req, res) => {\n" +
"  const order = await createOrder(req);           // lưu đơn của bạn, trạng thái 'pending'\n" +
"  const payment = await createPayment(order);     // hàm ở mục \"Tạo thanh toán\" (có gửi return_url)\n" +
"  await savePaymentId(order.id, payment.id);      // lưu payment.id để đối soát\n" +
"  res.redirect(303, payment.payment_url);         // chuyển hướng cả trang, không nhúng iframe\n" +
"});\n" +
"\n" +
"// 2) Khách bấm \"Quay lại cửa hàng\" trên trang của cổng, được đưa về:\n" +
"//    GET /checkout/result?order_id=...&payment_id=...&amount=...&status=...&paid_at=...&timestamp=...&signature=...\n" +
"app.get('/checkout/result', async (req, res) => {\n" +
"  // Mỗi tham số phải là chuỗi (chặn ?status=a&status=b thành mảng)\n" +
"  const q = Object.fromEntries(\n" +
"    Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : ''])\n" +
"  );\n" +
"\n" +
"  // a) KIỂM TRA CHỮ KÝ TRƯỚC TIÊN. Sai hoặc thiếu thì bỏ qua mọi tham số còn lại.\n" +
"  if (!verifyReturnSignature(q)) return res.status(400).send('Kết quả không hợp lệ');\n" +
"\n" +
"  // b) Dấu thời gian còn mới (ví dụ trong 1 giờ)\n" +
"  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(q.timestamp));\n" +
"  if (!Number.isInteger(Number(q.timestamp)) || age > 3600) return res.status(400).send('Liên kết đã quá cũ');\n" +
"\n" +
"  // c) Đối chiếu với đơn trong hệ thống của bạn, đừng tin số tiền trên URL\n" +
"  const order = await findOrder(q.order_id);\n" +
"  if (!order) return res.status(404).send('Không tìm thấy đơn hàng');\n" +
"  if (order.paymentId !== q.payment_id || order.amount !== Number(q.amount)) {\n" +
"    return res.status(400).send('Thông tin đơn hàng không khớp');\n" +
"  }\n" +
"\n" +
"  // d) Trạng thái đã được ký nên dùng được. Cập nhật phải idempotent như khi nhận callback.\n" +
"  if (order.status === 'pending') {\n" +
"    if (q.status === 'success') await markOrderPaid(order.id, q.paid_at);\n" +
"    else if (q.status === 'failed') await markOrderFailed(order.id);\n" +
"    order.status = q.status === 'success' ? 'paid' : 'failed';\n" +
"  }\n" +
"  res.render('result', { order });  // paid | failed\n" +
"});\n" +
"\n" +
"// Chữ ký dùng cùng hàm sign() ở mục \"Ký request\".\n" +
"// data = payment_id|amount|status|paid_at|order_id   (paid_at rỗng nếu không có)\n" +
"function verifyReturnSignature(q) {\n" +
"  if (!q.timestamp || !q.signature) return false;\n" +
"  const data = [q.payment_id, q.amount, q.status, q.paid_at || '', q.order_id].join('|');\n" +
"  const expected = Buffer.from(sign(q.timestamp, data));\n" +
"  const received = Buffer.from(q.signature);\n" +
"  return expected.length === received.length && crypto.timingSafeEqual(expected, received);\n" +
"}\n" +
"\n" +
"// Gọi API \"Kiểm tra trạng thái\" (request GET, ký với body rỗng)\n" +
"async function getPaymentStatus(orderId) {\n" +
"  const timestamp = Math.floor(Date.now() / 1000).toString();\n" +
"  const url = '" + EP_PAYMENT_STATUS + "'.replace('{order_id}', encodeURIComponent(orderId));\n" +
"  const res = await fetch(url, {\n" +
"    headers: {\n" +
"      'X-API-Key': process.env.WALLET_API_KEY,\n" +
"      'X-Timestamp': timestamp,\n" +
"      'X-Signature': sign(timestamp, ''),\n" +
"    },\n" +
"  });\n" +
"  const json = await res.json();\n" +
"  if (!res.ok) throw new Error(json.message);\n" +
"  return json.data;\n" +
"}",

            'code-callback-body':
'{\n' +
'  "payment_id": "pay_8f3a2c...",\n' +
'  "order_id": "ORD-20261017-001",\n' +
'  "amount": 150000,\n' +
'  "status": "success",\n' +
'  "paid_at": "2026-10-17T09:30:12Z"\n' +
'}',

            'code-callback-js':
"const express = require('express');\n" +
"const crypto = require('crypto');\n" +
"const app = express();\n" +
"\n" +
"app.post('/api/payment/callback',\n" +
"  express.raw({ type: 'application/json' }),\n" +
"  async (req, res) => {\n" +
"    const rawBody = req.body.toString('utf8');\n" +
"    const timestamp = req.header('X-Timestamp') || '';\n" +
"    const signature = req.header('X-Signature') || '';\n" +
"\n" +
"    // 1. Từ chối callback quá cũ (mỗi lần gửi đều có timestamp mới)\n" +
"    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {\n" +
"      return res.status(401).end();\n" +
"    }\n" +
"\n" +
"    // 2. Xác minh chữ ký\n" +
"    const expected = crypto\n" +
"      .createHmac('sha256', process.env.WALLET_SECRET_KEY)\n" +
"      .update(timestamp + '.' + rawBody)\n" +
"      .digest('hex');\n" +
"\n" +
"    const ok = signature.length === expected.length &&\n" +
"      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));\n" +
"    if (!ok) return res.status(401).end();\n" +
"\n" +
"    // 3. Xử lý idempotent: callback có thể đến trùng\n" +
"    const event = JSON.parse(rawBody);\n" +
"    const order = await findOrder(event.order_id);\n" +
"    if (!order || order.status === 'success') {\n" +
"      return res.status(200).json({ received: true });\n" +
"    }\n" +
"    if (event.amount !== order.amount) {\n" +
"      console.error('Sai số tiền', event); // ghi log để kiểm tra\n" +
"      return res.status(200).json({ received: true });\n" +
"    }\n" +
"\n" +
"    // Nếu lưu DB lỗi, để lỗi nổi lên (5xx) để cổng thanh toán gửi lại\n" +
"    if (event.status === 'success') {\n" +
"      await updateOrderStatus(order.id, 'success');\n" +
"    } else if (event.status === 'failed') {\n" +
"      await updateOrderStatus(order.id, 'failed');\n" +
"    }\n" +
"    res.status(200).json({ received: true });\n" +
"  }\n" +
");",

            'code-callback-body-failed':
'{\n' +
'  "payment_id": "pay_8f3a2c...",\n' +
'  "order_id": "ORD-20261017-002",\n' +
'  "amount": 150000,\n' +
'  "status": "failed",\n' +
'  "paid_at": null\n' +
'}',

            'code-status-res':
'{\n' +
'  "data": {\n' +
'    "payment_id": "pay_8f3a2c...",\n' +
'    "order_id": "ORD-20261017-001",\n' +
'    "amount": 150000,\n' +
'    "status": "success",\n' +
'    "transaction_id": "100000000073",\n' +
'    "paid_at": "2026-10-17T09:30:12Z",\n' +
'    "created_at": "2026-10-17T09:28:00Z",\n' +
'    "expires_at": "2026-10-17T09:43:00Z"\n' +
'  }\n' +
'}'
        };

function renderGuide() {
    Object.keys(SAMPLES).forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = SAMPLES[id];
    });
    document.getElementById('guide-base-url').textContent = GATEWAY_BASE;
    document.getElementById('ep-create').textContent = EP_CREATE_PAYMENT;
    document.getElementById('ep-status').textContent = EP_PAYMENT_STATUS;
}

function initGuideSpy() {
    const links = Array.from(document.querySelectorAll('#guide-toc .guide-link'));
    const sections = links.map((a) => document.querySelector(a.getAttribute('href')));
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id));
        });
    }, { rootMargin: '-90px 0px -60% 0px' });
    sections.forEach((s) => s && observer.observe(s));
}

async function copyCode(id, btn) {
    await copyText(document.getElementById(id).textContent);
    const old = btn.textContent;
    btn.textContent = 'Đã copy';
    setTimeout(() => { btn.textContent = old; }, 1500);
}