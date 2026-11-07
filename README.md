# Lớp Học Chữ

Game tương tác cho TikTok LIVE. Màn hình là một lớp học 2D có cô giáo **cô Ngân**: cô đọc đề, chữ cái xáo trộn hiện trên bảng đen, người xem gõ đáp án vào bình luận. Ai đúng nhanh nhất được nhiều điểm nhất và được ngồi bàn đầu.

## Tính năng

**Tiết học 20 câu, nhịp nhanh**
- 2.500 câu hỏi tiếng Việt, 34 chủ đề, mỗi câu là một dòng trong file text (`src/game/cau-hoi/`). Có bộ câu cho Gen Z và người đi làm, câu đời thường, ca dao thành ngữ.
- Mỗi tiết có: câu chữ xáo, 5 câu **đuổi hình bắt chữ** (hình emoji, hiện sẵn chữ cái đầu), 4 câu **toán nhẩm** tự sinh, 2 câu **tiếng Anh**, 2 câu **lịch sử Việt Nam**, phần **đố mẹo** 2 câu liền giữa tiết. Câu 20 là **câu hỏi vàng** nhân đôi điểm.
- Cô đọc: "Câu 3. Đây là một từ gồm 7 chữ cái. <gợi ý>". **Đọc xong đề mới hiện bảng chữ và mới nhận đáp án**; lúc cô đọc bảng chỉ hiện "Câu 3". Ai gửi đáp án trong lúc cô còn đọc thì không tính (xét theo giờ gửi, kể cả bình luận tới trễ), nhưng không mất lượt.
- Đủ 5 bạn đúng là 3 giây sau chốt câu, khỏi chờ hết giờ.

**Chấm điểm công bằng**
- Xếp ai nhanh nhất theo giờ TikTok ghi lúc người xem bấm gửi, không theo lúc máy nhận. Bảng **Top 5 nhanh nhất** ghi thời gian tới mili giây.
- Top 5 được 10 / 7 / 5 / 3 / 3 điểm, chậm hơn +1 (chép đáp án trên khung chat chỉ được 1 điểm). Đúng liền 5, 12, 17 câu được thưởng thêm.
- Phải gõ có dấu; kiểu bỏ dấu cũ và mới ("hóa" / "hoá") đều đúng. Nói chuyện thường không bị tính là trả lời sai.
- Gõ sai thì lên đứng phạt giơ tay cạnh cô 3 câu.

**Lớp học sống động**
- Bình luận là có ghế (30 ghế trên 4 dãy bàn), chia 4 tổ thi đua, lớp trưởng mỗi tiết, bảng "Học sinh xuất sắc trong tiết", bảng "Top tương tác" (làm lại mỗi buổi live).
- Học bạ cả đời: điểm cộng dồn để lên lớp 1 tới lớp 12 rồi tốt nghiệp, huy hiệu theo số câu đúng. Đi học nhiều ngày liền thì cô nhớ mặt. Gõ "sinh nhật" thì có bánh kem.
- Giờ ra chơi (oẳn tù tì, kiểm tra miệng, chọn phe, điểm danh, thả tim) và 2 game lớn **Đường lên đỉnh Everest**, **Rung Chuông Đồng** (trắc nghiệm A/B/C/D, nhạc nền tự tạo).
- Cô Ngân có 3 bộ trang phục, đổi sau mỗi tiết, nhiều tư thế theo tình huống. Giọng nữ Edge TTS tiếng Việt, vài trăm câu thoại: khen "thần đồng" khi trả lời siêu nhanh, trêu nhẹ khi sai, chào theo giờ.

**Quà chỉ để cảm ơn**
- Bảng "🎁 Gửi tặng cô" (hoa hồng, bắn tim, bánh donut): ai tặng thì lên bục đưa cô, cô đáp lời riêng cho từng món, quà vào "Quỹ lớp". Quà **không** cho lợi thế gì trong game (TikTok không cho khuyến khích tặng quà, nhất là với trẻ em).

**Treo live cả ngày**
- Rớt kết nối TikTok thì tự nối lại, server tắt thì file BAT tự bật lại. Chịu được phòng đông (đo 13.000 người, vẽ màn hình dưới 1 ms).
- Trang báo cáo sau buổi live: câu khó, câu quá dễ, chuyên cần, và **người xem tăng/giảm theo từng phần** để biết phần nào làm khách rời live.

## Cần có

- Máy tính Windows (file chạy sẵn là `BAT-LIVE.bat`; Mac/Linux xem phần cuối).
- Mạng internet (giọng đọc lấy từ Edge TTS).
- Tài khoản TikTok được phép LIVE và phần mềm [TikTok LIVE Studio](https://www.tiktok.com/studio/download).

## Hướng dẫn cài đặt (làm 1 lần)

**Bước 1: Cài Node.js**
Vào https://nodejs.org/, tải bản **LTS** (nút màu xanh), mở file vừa tải và bấm **Next** tới hết. Cài xong không cần mở gì.

**Bước 2: Tải game về máy**
Ở đầu trang GitHub này bấm nút xanh **Code → Download ZIP**. Giải nén ra một thư mục, ví dụ `D:\lop-hoc-chu`.
(Ai quen dùng git thì gõ `git clone https://github.com/workaipvlinh-byte/lop-hoc-chu.git`.)

**Bước 3: Chạy game**
Mở thư mục vừa giải nén, bấm đúp vào file **`BAT-LIVE.bat`**. Lần đầu máy tự cài thư viện, chờ 1–2 phút.
Cửa sổ đen hiện dòng `Server chạy ở http://localhost:3006` là xong. Khoảng 8 giây sau trình duyệt tự mở **trang điều khiển** `http://localhost:3006`.
Để cửa sổ đen chạy suốt buổi live; đóng nó là tắt game.

**Bước 4: Thử trước khi live (không bắt buộc)**
Ở trang điều khiển bấm các nút giả lập (1 bạn trả lời đúng, tặng hoa, 1000 người cùng đoán...) để xem game chạy.

## Hướng dẫn lên live (mỗi buổi)

**Bước 1: Bật game**
Bấm đúp `BAT-LIVE.bat` (nếu chưa bật).

**Bước 2: Bắt đầu phát trực tiếp**
Mở TikTok LIVE Studio, bấm **Phát trực tiếp** (Go LIVE).

**Bước 3: Kết nối game với buổi live**
Ở trang điều khiển `http://localhost:3006`, nhập username TikTok (không cần @) rồi bấm **Kết nối**. Báo "chưa LIVE" nghĩa là tài khoản chưa phát trực tiếp. Lần sau bật game sẽ tự kết nối.

**Bước 4: Đưa màn hình lớp học vào LIVE Studio** (làm 1 lần, lần sau giữ nguyên)
Trong LIVE Studio thêm nguồn **Link**:
- Đường dẫn: `http://lvh.me:3006/?view=stage`
- Bật **Turn on sound** (để có giọng cô).
- Bật **Custom resolution**, nhập **1620 × 2880** (chữ nét hơn hẳn; 1080 × 1920 cũng chạy được), bấm **Apply**.
- Bấm nút **vừa màn hình** để khung lớp học phủ kín khung điện thoại dọc.

LIVE Studio không nhận chữ `localhost`; `lvh.me` là tên miền trỏ về chính máy mình nên dùng được.
Chỉ mở trang `?view=stage` ở **một chỗ** (LIVE Studio). Mở thêm ở trình duyệt khác sẽ nghe hai giọng cô đè nhau. Trang điều khiển không phát tiếng, mở bao nhiêu tab cũng được.

**Bước 5: Kết thúc buổi live**
Trước khi tắt live, bấm nút **👋 Chào tạm biệt (xuống live)** ở trang điều khiển: cô chào cả lớp, hiện biểu ngữ tan lớp. Sau đó tắt live như bình thường. Xem lại buổi live ở nút **📊 Báo cáo** hoặc `http://localhost:3006/bao-cao`.

Dùng OBS cũng được: thêm nguồn **Browser**, cùng đường dẫn và khổ trên.

## Trang điều khiển

- **Tên lớp**: đổi chữ trên bảng hiệu.
- **🏫 Cài đặt lớp** (đổi là màn hình đổi ngay, không cần tải lại, tắt máy vẫn nhớ):
  - **Tên cô giáo**: bảng tên trên ngực và những câu cô tự xưng tên.
  - **Giọng cô giáo**: nữ (HoaiMy) hoặc nam (NamMinh).
  - **Chữ bảng đỏ**: dòng khẩu hiệu phía trên bảng đen, tối đa 40 ký tự.
  - **Cuộc thi**: bật tắt Everest, Rung Chuông Đồng ngay trong buổi live. Tắt cả 2 thì chỉ có giờ ra chơi. Game đang chơi dở vẫn chơi hết.
  - **Nền lớp học**: chọn ảnh dọc 9:16 (PNG, JPG, WEBP, tối đa 12 MB). Game tự vẽ tấm bảng đen lên ảnh mới. Bấm **Về nền gốc** để trả lại.
- **Giọng đọc trên stage**: gõ câu cho cô đọc ngay.
- **Tốc độ giọng**: kéo thanh trượt, có tác dụng ngay khi đang live.
- **⏭ Qua phần tiếp / 🔄 Ván mới / 🚫 Bỏ câu này**: điều khiển lớp bằng tay. Câu bị bỏ sẽ không bao giờ hỏi lại.
- **Chúc sinh nhật**, **ra chơi ngay**, **chơi game lớn ngay**, **👋 Chào tạm biệt**.
- Các nút giả lập để thử khi chưa live.

## Thêm hoặc sửa câu hỏi

Mỗi file trong `src/game/cau-hoi/` là một chủ đề:

```text
# Món ăn Việt
> Đây là một món ăn.
PHỞ | Món nước nổi tiếng của Hà Nội, bánh dẹt, nước dùng xương. | 1
BÁNH XÈO | Đổ bột kêu xèo xèo, ăn cuốn rau sống. | 2
NEM RÁN | Cuốn bánh đa nem rồi chiên vàng giòn. | 2 | CHẢ GIÒ
```

- Dòng `#` là tên chủ đề, dòng `>` là loại từ (bộ lịch sử, đuổi hình bắt chữ dùng để cô đọc "Đây là tên một vị vua gồm 11 chữ cái").
- Mỗi câu: `ĐÁP ÁN | gợi ý | độ khó (1 dễ, 2 vừa, 3 khó) | cách viết khác cũng tính đúng`.
- Đáp án tối đa 14 chữ cái (đuổi hình bắt chữ 16), không tính khoảng trắng. Gợi ý không được chứa nguyên đáp án.
- File tên đuôi `-meo`, `-su`, `-anh`, `-dh` là bộ đố mẹo, lịch sử, tiếng Anh, đuổi hình bắt chữ (chỉ hỏi ở đúng vị trí của chúng trong tiết).
- Câu 2 game lớn ở `src/game/cau-hoi-show/`.

Sửa xong chạy kiểm tra (mở cửa sổ lệnh trong thư mục game):

```bash
npx tsx src/game/bank.check.ts
```

Lời thoại của cô nằm ở `src/game/loi-thoai.ts`; các con số (thời gian mỗi câu, điểm, thứ tự câu trong tiết...) ở `src/game/config.ts`.

## Tuỳ chỉnh khác

Tạo file `.env` cạnh `server.ts` nếu muốn đổi:

```text
PORT=3006
TTS_VOICE=vi-VN-HoaiMyNeural
TTS_PITCH=+6%
```

`PORT` đổi ở đây thì nhớ sửa cả dòng `set PORT=3006` trong `BAT-LIVE.bat` và đường dẫn trong LIVE Studio.

Dữ liệu buổi live (câu đã hỏi, điểm, học bạ, báo cáo, ảnh nền riêng) nằm ở thư mục `data/`. Xoá thư mục đó là làm lại từ đầu.

## Mac / Linux

```bash
npm install
PORT=3006 LIVE_MODE=1 npm run dev
```

## Kiểm tra code

```bash
npx tsx src/game/quiz.check.ts
npx tsx src/game/bank.check.ts
npm run lint
```

## Lưu ý

- Kết nối TikTok dùng thư viện [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector). Thư viện này không phải của TikTok, các bạn tự cân nhắc khi dùng. Phòng quá đông thì TikTok có thể không gửi đủ 100% bình luận.
- Giọng đọc dùng Edge TTS qua thư viện `msedge-tts`, cần mạng; lỗi nhiều lần thì tự chuyển sang Google TTS.
- Không bao giờ đọc nguyên văn bình luận của người xem; tên và bình luận đi qua bộ lọc từ cấm (`src/live/bannedWords.ts`) trước khi hiện.

## Giấy phép

Mã nguồn dùng giấy phép [MIT](LICENSE). Ảnh nhân vật cô Ngân, học sinh và ảnh nền (`nhan-vat/`, `public/assets/`) thuộc về tác giả; muốn dùng cho kênh của mình thì nên thay bằng ảnh riêng.
