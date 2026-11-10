# MicroEmu Studio

Giao diện React + Vite + CSS kết nối với MicroEmulator 2.0.4 gốc chạy trong tiến trình Java riêng cho mỗi phiên. Trình duyệt gửi tệp JAR khi bấm **Chạy**, hiển thị khung hình PNG do MicroEmulator tạo và chuyển phím bấm về máy chủ.

## Chạy thử

Danh sách trò chơi trống khi mở lần đầu. Bạn có thể thêm JAR của mình từ nút **Upload**.

Cần Node.js 20.19+ hoặc 22.12+, npm và Java 21 trong PATH.

```sh
npm ci
npm run dev
```

Mở địa chỉ Vite in ra, bấm **Upload**, đặt tên tab, chọn JAR cùng JAD nếu có trong ô Upload, hoặc dùng **Chọn file đã có**. Chọn kích thước màn hình rồi bấm **Lưu và khởi chạy**. Danh sách và tệp đã chọn được giữ trong trình duyệt để mở lại. Tệp cần có thuộc tính `MIDlet-1` trong `META-INF/MANIFEST.MF` và dung lượng tối đa 25 MB.

Để chạy bản đã build trên cùng máy chủ:

```sh
npm run build
npm run preview
```

API Java được gắn vào cả hai lệnh qua cấu hình Vite. Chỉ phục vụ thư mục `dist/` sẽ thiếu API chạy MicroEmulator.

## Phiên tạm

Máy chủ mặc định chỉ lắng nghe nội bộ. Mỗi phiên dùng một thư mục tạm, tối đa hai phiên chạy cùng lúc. Tệp JAR được xóa khi tiến trình Java kết thúc. Quay lại hoặc đóng trình duyệt sẽ giữ phiên đang chạy. Mở lại bằng cùng hồ sơ trình duyệt để tiếp tục. Thoát trong menu game sẽ mở lại MIDlet trong cùng phiên. Nút **Đóng** kết thúc riêng phiên đang mở. Các phiên chỉ tồn tại khi máy chủ tạm còn chạy. Mỗi lần lưu tạo một tab với mã riêng, kể cả khi dùng lại cùng tệp. Biểu tượng cài đặt ở danh sách cho phép đổi tên, đổi kích thước màn hình hoặc xoá tab sau khi xác nhận. Tệp JAR/JAD được giữ nếu một tab khác vẫn dùng chúng. Mỗi tab chạy trong tiến trình Java riêng, với dữ liệu RecordStore trong bộ nhớ của phiên đó. Kết nối HTTP từ MIDlet bị tắt.

Bản này dành cho máy chủ thử nghiệm và tệp JAR bạn tin cậy.

## Cấu trúc

- `src/main.jsx` chứa trang chủ, trang điều khiển và bàn phím ảo.
- `src/games.js` lưu danh sách và tệp JAR trong trình duyệt.
- `src/emulator-client.js` gửi tệp JAR và nhận hình ảnh màn hình từ máy chủ.
- `server/emulator.js` quản lý phiên và tiến trình Java.
- `java/ServerPlayer.java` kết nối API hiển thị và phím của MicroEmulator với máy chủ.
- `server/runtime/` chứa MicroEmulator 2.0.4 từ [bản phát hành gốc](https://sourceforge.net/projects/microemulator/files/microemulator/2.0.4/) và cầu nối Java đã biên dịch.

Biên dịch lại cầu nối bằng JDK 21 sau khi chỉnh sửa:

```sh
mkdir -p java-build
javac --release 8 -cp server/runtime/microemulator.jar -d java-build java/ServerPlayer.java
jar cf server/runtime/server-player.jar -C java-build studio
```
