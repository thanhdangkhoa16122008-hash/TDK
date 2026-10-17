// story.js — toàn bộ chữ của game: thư, lời thoại, mục tiêu, vật phẩm.

export const ITEMS = {
  brass:  { icon: '🗝️', name: 'Chìa khóa đồng', desc: 'Chìa khóa phòng làm việc của ba.' },
  fuse:   { icon: '🔌', name: 'Cầu chì', desc: 'Cầu chì dự phòng. Lắp vào hộp điện trong kho.' },
  photo:  { icon: '🖼️', name: 'Tấm ảnh gia đình', desc: 'Ba, mẹ, anh Minh và bé Hạnh. Mùa hè 1997.' },
  child:  { icon: '🔑', name: 'Chìa khóa nhỏ', desc: 'Móc khóa hình con thỏ. Chìa phòng bé Hạnh.' },
  doll:   { icon: '🧸', name: 'Búp bê Mi-Mi', desc: 'Búp bê của Hạnh. Một bên mắt nút đã rơi mất.' },
  musicbox: { icon: '🎵', name: 'Hộp nhạc', desc: 'Hộp nhạc gỗ. Vặn dây sẽ phát bài ru quen thuộc.' },
  gate:   { icon: '🗝️', name: 'Chìa khóa cổng', desc: 'Chìa khóa cửa chính. Chạy đi!' },
};

export const NOTES = {
  intro: {
    title: 'Mảnh giấy trên bàn',
    text: `Hạnh ơi,

Mẹ đi chợ đêm, về muộn. Chìa khóa phòng làm việc của ba, mẹ bỏ trong HŨ BÁNH dưới bếp — chỗ con hay lén lấy bánh đó. Đừng vào phòng ba nghịch nhé.

Ngủ sớm. Khóa cửa cẩn thận.
— Mẹ

(Giấy ố vàng. Góc dưới ghi: 15/07/1997)`,
  },
  diary: {
    title: 'Nhật ký của ba',
    text: `15/07/1997

Đêm đó tôi nghe tiếng hộp nhạc trong phòng con bé. Chạy vào thì chỉ thấy một BÓNG ĐEN cao lêu nghêu đứng ở góc phòng. Bật đèn lên — Hạnh không còn ở đó nữa.

Cái đồng hồ quả lắc ngoài phòng khách dừng đúng lúc ấy. Tôi không dám lên dây nó nữa.

Tôi đổi mã KÉT SẮT thành đúng giờ đó, viết theo kiểu 24 GIỜ như sổ trực của tôi, để không bao giờ quên.

Trong két là tấm ảnh cuối cùng của cả nhà.`,
  },
  fusebox: {
    title: 'Giấy dán trên hộp điện',
    text: `HỘP ĐIỆN TỔNG

Cầu chì hay cháy. Cầu chì dự phòng để trong TỦ DƯỚI GƯƠNG NHÀ TẮM.

Không có điện thì két sắt điện tử không mở được!`,
  },
  mother: {
    title: 'Thư của mẹ',
    text: `Hạnh cứ kể có "chú cao cao" đứng nhìn con bé ngủ mỗi đêm. Tôi tưởng con nói mơ.

Con ôm búp bê Mi-Mi suốt, bảo Mi-Mi canh cho con. Hộp nhạc con giấu trong RƯƠNG BÍ MẬT, không cho ai đụng vào.

Nếu con có trở về, mẹ sẽ đặt lên BÀN THỜ những thứ con thương nhất: TẤM ẢNH cả nhà, BÚP BÊ Mi-Mi và HỘP NHẠC.

Để con biết đường về nhà.`,
  },
  chest: {
    title: 'Giấy dán trên rương',
    text: `RƯƠNG BÍ MẬT CỦA HẠNH!!!

Ai muốn mở phải biết thứ tự các bạn của Hạnh trong BỨC TRANH trên tường.

Chú cao cao KHÔNG ĐƯỢC mở!!`,
  },
};

// Mục tiêu hiện tại, tính từ trạng thái game
export function objective(S) {
  const f = S.flags, has = (i) => S.inv.includes(i);
  if (f.won) return 'Đã thoát.';
  if (f.final) return 'CHẠY! Mở cửa chính ở phòng khách.';
  if (!f.studyOpen && !has('brass')) return S.notes.includes('intro') ? 'Tìm hũ bánh trong bếp.' : 'Cửa chính bị khóa. Lục soát phòng khách.';
  if (!f.studyOpen) return 'Mở phòng làm việc (cuối hành lang, bên trái).';
  if (!S.notes.includes('diary') && !f.safeOpen) return 'Lục soát phòng làm việc.';
  if (!f.safeOpen && !f.power) return has('fuse') ? 'Lắp cầu chì vào hộp điện trong nhà kho.' : 'Nhà mất điện. Tìm cầu chì và hộp điện.';
  if (!f.safeOpen) return 'Mở két sắt. Mật mã là giờ đồng hồ quả lắc dừng.';
  const placed = ['photo', 'doll', 'musicbox'].filter((i) => f['altar_' + i]).length;
  if (!S.notes.includes('mother') && placed === 0) return 'Tìm hiểu chuyện gì đã xảy ra với Hạnh (phòng ngủ, phòng bé).';
  return `Đặt ảnh, búp bê, hộp nhạc lên bàn thờ (${placed}/3).`;
}

export const INTRO = [
  ['Minh', 'Hai mươi năm rồi... Em gái tôi, bé Hạnh, biến mất trong căn nhà này năm nó bảy tuổi.'],
  ['Minh', 'Ba mẹ dọn đi, căn nhà bỏ hoang từ đó. Tôi phải biết chuyện gì đã xảy ra.'],
];
export const INTRO_SLAM = [
  ['Minh', 'Cửa... tự đóng lại? Khóa cứng rồi. Phải tìm chìa khóa cổng.'],
];

export const FINAL = [
  ['Hạnh', 'Anh hai... anh về rồi.'],
  ['Hạnh', 'Chú cao cao giữ em ở đây lâu lắm. Giờ em đi được rồi.'],
  ['Hạnh', 'Chìa khóa cổng nè. Anh chạy đi... NÓ ĐANG TỚI!'],
];

export const ENDING = `Cánh cửa bật mở. Mưa đã tạnh.

Sau lưng, căn nhà chìm vào im lặng — lần đầu tiên sau hai mươi năm.

Đâu đó vang lên tiếng hộp nhạc, rồi tắt dần.

"Tạm biệt anh hai."`;
