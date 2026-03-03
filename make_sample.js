const XLSX = require("xlsx");
const wb = XLSX.utils.book_new();
const ws_data = [
    ["방 이름(조명)", "Player 1 (선택)", "Player 2 (선택)"],
    ["코끼리조", "김철수", "이영희"],
    ["기린조", "박지민", "최민수"],
    ["원숭이조", "홍길동", "임꺽정"]
];
const ws = XLSX.utils.aoa_to_sheet(ws_data);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
XLSX.writeFile(wb, "admin_rooms_sample.xlsx");
console.log("admin_rooms_sample.xlsx created.");
