import express from 'express';
import { TikTokLiveConnection } from 'tiktok-live-connector';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  app.use(cors());

  let sseClients: any[] = [];

  function sendSSE(type: string, data: any) {
    sseClients.forEach(client => {
      client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
  }

  app.get('/api/tiktok/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    sseClients.push({ req, res });
    req.on('close', () => {
      sseClients = sseClients.filter(client => client.req !== req);
    });
  });

  // ĐIỀN TÊN KÊNH TIKTOK CỦA BẠN VÀO ĐÂY:
  const tiktokUsername = 'ptitvov91'; 
  const tiktokLiveConnection = new TikTokLiveConnection(tiktokUsername, {});
  tiktokLiveConnection.connect().then(state => {
    console.info(`✅ Đã kết nối phòng LIVE: ${state.roomId}`);
    sendSSE('status', { connected: true, channelName: tiktokUsername });
  }).catch(err => console.error('❌ Lỗi kết nối TikTok:', err));

  tiktokLiveConnection.on('chat', (data: any) => {
    const msg = data.comment.trim().toLowerCase();
    if (msg === 'vào lớp' || msg.startsWith('tổ')) {
      let group = Math.floor(Math.random() * 4) + 1;
      if (msg.includes('tổ 1')) group = 1;
      else if (msg.includes('tổ 2')) group = 2;
      else if (msg.includes('tổ 3')) group = 3;
      else if (msg.includes('tổ 4')) group = 4;

      sendSSE('joinClass', {
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        avatar: data.profilePictureUrl,
        group: group
      });
    } else {
      sendSSE('chat', { uniqueId: data.uniqueId, nickname: data.nickname, comment: data.comment });
    }
  });

  tiktokLiveConnection.on('like', (data: any) => {
    sendSSE('like', { totalLikes: data.totalLikeCount, addLikes: data.likeCount });
  });

  tiktokLiveConnection.on('gift', (data: any) => {
    if (data.giftType === 1 && !data.repeatEnd) return; 
    sendSSE('gift', {
      nickname: data.nickname,
      giftName: data.giftName,
      diamondCount: data.diamondCount,
      repeatCount: data.repeatCount
    });
  });

  // Tích hợp Giao diện Game vào chung Máy chủ
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const PORT = process.env.PORT || 3006;
  app.listen(PORT, () => console.log(`🚀 Game & TikTok Server đang chạy tại: http://localhost:${PORT}`));
}

startServer();