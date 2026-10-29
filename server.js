const WebSocket = require('ws');

// Render PORT ortam değişkenini otomatik atar
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let waitingPlayer = null;
const rooms = new Map();

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

wss.on('connection', (ws) => {
    ws.roomId = null;
    ws.playerColor = 0;
    ws.rotationRule = 0;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. HIZLI EŞLEŞME (Rastgele Rakip)
            if (data.type === 'quick_match') {
                if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === WebSocket.OPEN) {
                    const roomId = "QM_" + Math.random().toString(36).substring(2, 7);
                    const p1 = waitingPlayer;
                    const p2 = ws;
                    waitingPlayer = null;

                    p1.roomId = roomId;
                    p2.roomId = roomId;

                    // Kura çekimi (1: Beyaz ilk başlar, 2: Siyah)
                    const p1Color = Math.random() < 0.5 ? 1 : 2;
                    const p2Color = p1Color === 1 ? 2 : 1;
                    p1.playerColor = p1Color;
                    p2.playerColor = p2Color;

                    // Hızlı eşleşmede standart kural: 0 (Çift Yön)
                    const sharedRule = 0;
                    rooms.set(roomId, { p1, p2, rotationRule: sharedRule });

                    send(p1, { 
                        type: 'match_found', 
                        roomId, 
                        yourColor: p1Color, 
                        oppName: "Rakip", 
                        rotationRule: sharedRule 
                    });
                    send(p2, { 
                        type: 'match_found', 
                        roomId, 
                        yourColor: p2Color, 
                        oppName: "Rakip", 
                        rotationRule: sharedRule 
                    });
                } else {
                    waitingPlayer = ws;
                    send(ws, { type: 'waiting_for_opponent' });
                }
            }

            // 2. ODA OLUŞTURMA (Arkadaşla Oyna)
            else if (data.type === 'create_room') {
                const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
                ws.roomId = roomCode;
                // Oda kurucunun seçtiği dönme kuralını al (0: Çift yön, 1: Saat yönü, 2: Tersi)
                ws.rotationRule = (typeof data.rotationRule !== 'undefined') ? data.rotationRule : 0;

                rooms.set(roomCode, { 
                    host: ws, 
                    guest: null, 
                    rotationRule: ws.rotationRule 
                });

                send(ws, { type: 'room_created', roomCode });
            }

            // 3. ODAYA KATILMA
            else if (data.type === 'join_room') {
                const room = rooms.get(data.roomCode);
                if (room && !room.guest) {
                    room.guest = ws;
                    ws.roomId = data.roomCode;

                    // Adil Kura: Kurucu veya Katılan %50 ihtimalle Beyaz olur
                    const hostColor = Math.random() < 0.5 ? 1 : 2;
                    const guestColor = hostColor === 1 ? 2 : 1;
                    room.host.playerColor = hostColor;
                    room.guest.playerColor = guestColor;

                    // Her iki oyuncuya da aynı dönme kuralını ve renkleri gönder
                    send(room.host, { 
                        type: 'match_found', 
                        roomId: data.roomCode, 
                        yourColor: hostColor, 
                        oppName: "Arkadaş", 
                        rotationRule: room.rotationRule 
                    });
                    send(room.guest, { 
                        type: 'match_found', 
                        roomId: data.roomCode, 
                        yourColor: guestColor, 
                        oppName: "Oda Kurucusu", 
                        rotationRule: room.rotationRule 
                    });
                } else {
                    send(ws, { type: 'error', message: 'Oda bulunamadı veya oda dolu!' });
                }
            }

            // 4. OYUN HAMLELERİ (Taş Koyma ve Blok Döndürme)
            else if (data.type === 'game_action') {
                const room = rooms.get(ws.roomId);
                if (room) {
                    // Hamleyi atan dışındaki diğer rakip oyuncuyu bul
                    let opponent = null;
                    if (room.p1 && room.p2) {
                        opponent = (room.p1 === ws) ? room.p2 : room.p1;
                    } else if (room.host && room.guest) {
                        opponent = (room.host === ws) ? room.guest : room.host;
                    }

                    if (opponent) {
                        send(opponent, data);
                    }
                }
            }
        } catch (e) {
            console.error("Mesaj ayrıştırma hatası:", e);
        }
    });

    // Oyuncu Bağlantıyı Kestiğinde
    ws.on('close', () => {
        if (waitingPlayer === ws) {
            waitingPlayer = null;
        }

        if (ws.roomId && rooms.has(ws.roomId)) {
            const room = rooms.get(ws.roomId);
            let opponent = null;

            if (room.p1 && room.p2) {
                opponent = (room.p1 === ws) ? room.p2 : room.p1;
            } else if (room.host && room.guest) {
                opponent = (room.host === ws) ? room.guest : room.host;
            }

            if (opponent) {
                send(opponent, { type: 'opponent_left' });
            }
            rooms.delete(ws.roomId);
        }
    });
});

console.log(`PentaTwist WebSocket Sunucusu Port ${PORT} üzerinde hazır ve dinliyor.`);
