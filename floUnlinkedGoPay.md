### ĐÂY LÀ FLOW GỠ LIÊN KẾT THANH TOÁN OPENAI RA KHỎI GOPAY

* Điều kiện bắt buộc của flow:
- Thực hiện chính xác tuyệt đối/có sai số thấp không ảnh hưởng đến luồng đi chính của tools.
- Luôn xác minh rằng click đã thành công chưa. Đã đến bước nào.
- Logging phải theo format của SignUp không  được sai lệch.

### TOÀN BỘ QUY TRÌNH FLOW GỠ LIÊN KẾT THANH TOÁN

## Home Button
- Dù đang ở bất kì chỗ nào thì cũng phải quay về màn hình chính.
+ Các bước đã debug:
    adb -s emulator-5558 shell am start -W -a android.intent.action.MAIN -c android.intent.category.HOME

### << IMPORTANT! MAIN FLOW UNLINKED OPENAI FOR GOPAY >>

## Find and Open GoPay
- Tìm và bật app GoPay.
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    node index="3" text="GoPay" resource-id="" class="android.widget.TextView" package="app.lawnchair" content-desc="GoPay" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="true" password="false" selected="false" bounds="[307,355][593,557]" />
    adb -s emulator-5558 shell input tap 450 456

## Find and Open Profile
- Tìm và mở Tab Profile.
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    adb -s emulator-5558 shell "cat /sdcard/window.xml | tr '<' '\n' | grep -i 'app settings'"
node index="0" text="" resource-id="" class="android.view.View" package="com.gojek.gopay" content-desc="Account &amp; app settings&#10;Control your app preferences, data, linked apps and more." checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[32,960][868,1136]">
    adb -s emulator-5558 shell input tap 450 1068

## Find and Open Account & App settings
- Tìm và mở "Account & app settings"
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    adb -s emulator-5558 shell "cat /sdcard/window.xml | tr '<' '\n' | grep -i 'app settings'"
node index="0" text="" resource-id="" class="android.view.View" package="com.gojek.gopay" content-desc="Account &amp; app settings&#10;Control your app preferences, data, linked apps and more." checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[32,960][868,1136]">
    adb -s emulator-5558 shell input tap 450 1068

## Find and tap Linked apps
- Tìm và mở "Linked apps"
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    adb -s emulator-5558 shell "cat /sdcard/window.xml | tr '<' '\n' | grep -i 'Linked apps'"
    adb -s emulator-5558 shell input tap 450 719

## Find and tap Unlink button
- Tìm và bấm button "unlink"
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    adb -s emulator-5558 shell "cat /sdcard/window.xml | tr '<' '\n' | grep -i Unlink"
node index="0" text="" resource-id="" class="android.widget.Button" package="com.gojek.gopay" content-desc="Unlink" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[647,192][836,264]" />
    adb -s emulator-5558 shell input tap 742 228

## Find and tap Unlink confirm button
- Tìm vá bấm button unlink (Not Unlink button previous step)
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    adb -s emulator-5558 shell "cat /sdcard/window.xml | tr '<' '\n' | grep -i Unlink"
node index="2" text="" resource-id="" class="android.widget.Button" package="com.gojek.gopay" content-desc="Unlink" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[32,1432][868,1520]" />
    adb -s emulator-5558 shell input tap 450 1476

## Confirmed Unlinked Success
- Tìm dấu hiệu "No apps linked to your GoPay"
+ Các bước đã debug:
    adb -s emulator-5558 shell uiautomator dump /sdcard/window.xml
    adb -s emulator-5558 shell "cat /sdcard/window.xml | tr '<' '\n' | grep -i 'No apps linked'"
node index="1" text="" resource-id="" class="android.view.View" package="com.gojek.gopay" content-desc="No apps linked to your GoPay" checkable="false" checked="false" clickable="false" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[143,1006][757,1062]" />

## Home Button
- Dù đang ở bất kì chỗ nào thì cũng phải quay về màn hình chính.
+ Các bước đã debug:
    adb -s emulator-5558 shell am start -W -a android.intent.action.MAIN -c android.intent.category.HOME

### IMPORTANT! ###
* TÔI ĐÃ DEBUG THỬ CÁC BƯỚC THANH TOÁN GOPAY THÀNH CÔNG. VÀ ĐÃ GHI RA TOÀN BỘ FLOW THỰC HIỆN NÓ MỘT CÁCH HOÀN HẢO.
* YÊU CẦU RE-DEBUG ĐỂ KIỂM TRA CÓ HỢP LỆ HẾT FLOW KHÔNG HAY LÀ CHỖ NÀO KHÔNG HOÀN THÀNH. DEBUG TỪNG BƯỚC VÀ XÁC NHẬN RẰNG NÓ HOẠT ĐỘNG TỐT THÌ MỚI ĐƯỢC IMPLEMENT VÀO CODE.
# TUYỆT ĐỐI NGHIÊM CẤM TỰ SÁNG TẠO LINH TINH KHI KHÔNG CÓ SỰ CHO PHÉP CỦA LÀM DẪN ĐẾN HƯ HỎNG HỆ THỐNG
# CHỈ ĐƯỢC PHÉP LÀM THEO FLOW CỦA TÔI ĐƯA RA KHÔNG ĐƯỢC THÊM BƯỚC BẤT CỨ 1 CHI TIẾT NÀO TRONG FLOW.
# YÊU CẦU ĐẦU RA PHẢI THỰC HIỆN THÀNH CÔNG CAO ĐẾN 90 99% VÌ TẤT CẢ ĐỀU LÀ TEXT/BUTTON TĨNH CỦA APP

### CỰC KÌ QUAN TRỌNG:
# DEBUG TỪNG BƯỚC LẠI 1 LẦN NỮA KHI LẠI QUÁ TRÌNH DEBUG ĐỂ CÓ THỂ KIỂM TRA PHÁT HIỆN BẤT THƯỜNG VÀ FIX NGAY TẠI CHỖ.
# NGHIÊM CẤM TUYỆT ĐỐI KHI CHƯA DEBUG VÀ XÁC NHẬN KÈM THEO LOG, FILE.MD, CHECKLST VÀ CHECK NHŨNG GÌ ĐÃ DEBUG RA VÀ BÁO CÁO LẠI TÌNH HÌNH CHO TÔI
#### CẤM TUYỆT ĐỐI LÀM 1 JOB DÀI KHÔNG CÓ CONTEXT, KĨ NĂM LÀM FAILED TOOL. BẮT BUỘC PHẢI DEBUG TỪNG STEP VÀ CÓ BÁO CÁO KẾ HOẠCH CỤ THỂ CHO TÔI TRƯỚC KHI TÔI CHO PHÉP IMPLEMENT
## CÁC TỌA ĐỘ CÓ THỂ BỊ SAI LỆCH KHI SỬ DỤNG CÁC THIẾT BỊ ANDROID KHÁC NHAU. LƯU Ý CỰC CHO ĐIỀU NÀY.
