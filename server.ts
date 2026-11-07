import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3006;

const TTS_VOICE = process.env.TTS_VOICE || 'vi-VN-HoaiMyNeural';
const TTS_PITCH = process.env.TTS_PITCH || '+6%';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'lvh.me']);
const hostOk = (h?: string) => !!h && LOCAL_HOSTS.has(h.replace(/:\d+$/, '').toLowerCase());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!hostOk(req.headers.host) || (origin && !hostOk(origin.replace(/^https?:\/\//, '')))) return res.status(403).end();
  next();
});

app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

interface LiveStats {
  isConnected: boolean;
  isConnecting: boolean;
  username: string;
  roomId: string;
  viewerCount: number;
  totalLikes: number;
  error?: string;
}

const emptyStats = (): LiveStats => ({
  isConnected: false,
  isConnecting: false,
  username: '',
  roomId: '',
  viewerCount: 0,
  totalLikes: 0,
  error: '',
});

let liveStats = emptyStats();
let sseClients: express.Response[] = [];
let stageIds: string[] = [];
const announceSpeaker = () => broadcast('speaker', { id: stageIds[stageIds.length - 1] ?? null, count: stageIds.length });
let activeConn: InstanceType<typeof TikTokLiveConnection> | null = null;
let lastRateControl: { action: string; text: string } | null = null;

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
let lastNameControl: { action: string; text: string } | null = null;
let wantUser = '';

type RoomSettings = { teacherName?: string; teacherVoice?: 'nu' | 'nam'; motto?: string; everest?: boolean; chuong?: boolean; bg?: string };
let settings: { channelName?: string; tiktokUser?: string; room?: RoomSettings } = {};
try {
  settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  if (typeof settings.channelName === 'string' && settings.channelName.trim()) {
    lastNameControl = { action: 'setName', text: settings.channelName.trim() };
  }
  if (typeof settings.tiktokUser === 'string') wantUser = settings.tiktokUser;
} catch {}

const saveSettings = (patch: typeof settings) => {
  settings = { ...settings, ...patch };
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Không lưu được settings.json:', err);
  }
};

function broadcast(eventType: string, data: unknown) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {}
  }
}

app.get('/api/tiktok/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: status\ndata: ${JSON.stringify(liveStats)}\n\n`);
  if (lastRateControl) res.write(`event: control\ndata: ${JSON.stringify(lastRateControl)}\n\n`);
  if (lastNameControl) res.write(`event: control\ndata: ${JSON.stringify(lastNameControl)}\n\n`);
  res.write(`event: roomCfg\ndata: ${JSON.stringify(settings.room ?? {})}\n\n`);
  sseClients.push(res);
  const stageId = typeof req.query.stage === 'string' ? req.query.stage.slice(0, 40) : '';
  if (stageId) {
    stageIds = [...stageIds.filter((x) => x !== stageId), stageId];
    announceSpeaker();
  } else res.write(`event: speaker\ndata: ${JSON.stringify({ id: stageIds[stageIds.length - 1] ?? null, count: stageIds.length })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter((c) => c !== res);
    if (stageId) {
      stageIds = stageIds.filter((x) => x !== stageId);
      announceSpeaker();
    }
  });
});

app.get('/api/tiktok/status', (_req, res) => res.json({ success: true, data: liveStats }));

const userOf = (data: any) => data?.user?.displayId || data?.user?.uniqueId || data?.uniqueId || 'nguoi-xem';
const nickOf = (data: any) => data?.user?.nickname || data?.nickname || data?.uniqueId || 'Bạn';
const avatarOf = (data: any) => data?.user?.avatarThumb?.urlList?.[0] || '';

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTries = 0;
function scheduleReconnect(why: string) {
  if (!wantUser || reconnectTimer) return;
  const delay = Math.min(120_000, 15_000 * 2 ** reconnectTries);
  reconnectTries++;
  console.log(`[TikTok] ${why}. Tự kết nối lại @${wantUser} sau ${delay / 1000} giây`);
  liveStats = { ...liveStats, isConnected: false, isConnecting: false, error: `${why}. Tự kết nối lại sau ${delay / 1000} giây` };
  broadcast('status', liveStats);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectTikTok(wantUser).catch((err) => scheduleReconnect(`Chưa kết nối lại được (${err instanceof Error ? err.message : err})`));
  }, delay);
}
const stopReconnect = () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectTries = 0;
};

app.post('/api/tiktok/connect', async (req, res) => {
  const cleanUser = String(req.body?.username || '').replace(/^@/, '').trim();
  if (!cleanUser) return res.status(400).json({ success: false, error: 'Chưa nhập username TikTok' });
  stopReconnect();
  wantUser = cleanUser;
  saveSettings({ tiktokUser: cleanUser });
  try {
    const state = await connectTikTok(cleanUser);
    return res.json({ success: true, roomId: state?.roomId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    scheduleReconnect(`Không kết nối được: ${msg}`);
    return res.status(400).json({
      success: false,
      error: `Không kết nối được @${cleanUser}: ${msg}. Tài khoản phải đang LIVE trên TikTok. Server sẽ tự thử lại.`,
    });
  }
});

async function connectTikTok(cleanUser: string) {
  if (activeConn) {
    try { activeConn.disconnect(); } catch {}
    activeConn = null;
  }

  liveStats = { ...emptyStats(), isConnecting: true, username: cleanUser };
  broadcast('status', liveStats);

  const conn = new TikTokLiveConnection(cleanUser, {
    processInitialData: true,
    enableExtendedGiftInfo: false,
  });

  conn.on(ControlEvent.CONNECTED, (state: { roomId?: string }) => {
    console.log(`[TikTok] Đã kết nối @${cleanUser}, room ${state?.roomId}`);
    liveStats = { ...liveStats, isConnected: true, isConnecting: false, roomId: state?.roomId || '', error: '' };
    newLiveRoom(state?.roomId || '');
    broadcast('status', liveStats);
    reconnectTries = 0;
  });

  conn.on(ControlEvent.DISCONNECTED, () => {
    console.log(`[TikTok] Mất kết nối @${cleanUser}`);
    if (activeConn !== conn) return;
    liveStats = { ...liveStats, isConnected: false, isConnecting: false };
    broadcast('status', liveStats);
    scheduleReconnect('Mất kết nối TikTok');
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    if (activeConn !== conn) return;
    liveStats = { ...liveStats, isConnected: false, isConnecting: false, error: 'Phiên live đã kết thúc' };
    broadcast('status', liveStats);
    scheduleReconnect('Phiên live đã kết thúc');
  });

  conn.on(WebcastEvent.CHAT, (data: any) => {
    broadcast('chat', {
      username: userOf(data),
      nickname: nickOf(data),
      comment: data?.content || data?.comment || '',
      avatar: avatarOf(data),
      timestamp: Date.now(),
      createTime: Number(data?.common?.createTime) || Date.now(),
    });
  });

  const streakCounts = new Map<string, number>();
  conn.on(WebcastEvent.GIFT, (data: any) => {
    const username = userOf(data);
    const giftId = data?.giftId || 0;
    const key = `${username}_${giftId}`;
    const total = data?.repeatCount || 1;
    const delta = total - (streakCounts.get(key) || 0);
    const isStreakable = (data?.gift?.type ?? data?.giftDetails?.giftType ?? data?.giftType) === 1;
    if (isStreakable && !data?.repeatEnd) streakCounts.set(key, total);
    else streakCounts.delete(key);
    if (delta <= 0) return;

    broadcast('gift', {
      username,
      nickname: nickOf(data),
      giftName: data?.gift?.name || data?.giftDetails?.giftName || data?.giftName || 'Quà',
      giftId,
      diamondCount: data?.gift?.diamondCount || data?.diamondCount || data?.giftDetails?.diamondCount || 1,
      repeatCount: delta,
      avatar: avatarOf(data),
      timestamp: Date.now(),
    });
  });

  conn.on(WebcastEvent.MEMBER, (data: any) => {
    broadcast('member', { username: userOf(data), nickname: nickOf(data), avatar: avatarOf(data), timestamp: Date.now() });
  });

  conn.on(WebcastEvent.FOLLOW, (data: any) => {
    broadcast('follow', { username: userOf(data), nickname: nickOf(data), avatar: avatarOf(data), timestamp: Date.now() });
  });

  conn.on(WebcastEvent.SHARE, (data: any) => {
    broadcast('share', { username: userOf(data), nickname: nickOf(data), avatar: avatarOf(data), timestamp: Date.now() });
  });

  conn.on(WebcastEvent.ROOM_USER, (data: any) => {
    if (typeof data?.viewerCount === 'number') {
      liveStats.viewerCount = data.viewerCount;
      broadcast('roomUser', { viewerCount: data.viewerCount });
    }
  });

  conn.on(WebcastEvent.LIKE, (data: any) => {
    if (typeof data?.totalLikeCount === 'number') liveStats.totalLikes = data.totalLikeCount;
    broadcast('like', {
      username: userOf(data),
      nickname: nickOf(data),
      likeCount: data?.likeCount || 1,
      totalLikes: liveStats.totalLikes,
    });
  });

  conn.on(ControlEvent.ERROR, (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[TikTok] Lỗi @${cleanUser}:`, msg);
    liveStats.error = msg;
    broadcast('status', liveStats);
  });

  activeConn = conn;

  try {
    const live = await conn.fetchIsLive().catch(() => true);
    if (!live) throw new Error('TikTok báo tài khoản này CHƯA LIVE. Bấm Phát trực tiếp trong LIVE Studio trước rồi mới kết nối');
    return await Promise.race([
      conn.connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('quá 30 giây không vào được phòng live')), 30_000)),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    liveStats = { ...liveStats, isConnected: false, isConnecting: false, error: msg };
    broadcast('status', liveStats);
    if (activeConn === conn) {
      try { conn.disconnect(); } catch {}
      activeConn = null;
    }
    throw err;
  }
}

app.post('/api/tiktok/disconnect', (_req, res) => {
  stopReconnect();
  wantUser = '';
  saveSettings({ tiktokUser: '' });
  try { activeConn?.disconnect(); } catch {}
  activeConn = null;
  liveStats = emptyStats();
  broadcast('status', liveStats);
  res.json({ success: true });
});

const CONTROL_ACTIONS = ['speak', 'setRate', 'reset', 'setName', 'custom'];
app.post('/api/control', (req, res) => {
  const { action, text } = req.body || {};
  if (!CONTROL_ACTIONS.includes(action)) return res.status(400).json({ success: false, error: 'Lệnh không hợp lệ' });
  if (action === 'speak' && (typeof text !== 'string' || !text.trim())) {
    return res.status(400).json({ success: false, error: 'Chưa nhập nội dung cần đọc' });
  }
  const payload = { action, text: typeof text === 'string' ? text.trim().slice(0, 1000) : undefined };
  if (action === 'setRate' && payload.text) lastRateControl = { action, text: payload.text };
  if (action === 'setName') {
    const name = (payload.text || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ success: false, error: 'Chưa nhập tên kênh' });
    payload.text = name;
    lastNameControl = { action, text: name };
    saveSettings({ channelName: name });
  }
  broadcast('control', payload);
  res.json({ success: true, pages: sseClients.length });
});

const TEST_EVENTS = ['chat', 'gift', 'member', 'follow', 'share', 'like'];
app.post('/api/test/emit', (req, res) => {
  const { type, data } = req.body || {};
  if (!TEST_EVENTS.includes(type)) return res.status(400).json({ success: false, error: 'Loại sự kiện không hợp lệ' });
  const event = { timestamp: Date.now(), avatar: '', ...(data || {}) };
  if (type === 'like') {
    liveStats.totalLikes += Number(event.likeCount) || 1;
    event.totalLikes = liveStats.totalLikes;
  }
  broadcast(type, event);
  res.json({ success: true });
});

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function splitText(text: string, max = 190): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const win = rest.slice(0, max + 1);
    let cut = Math.max(win.lastIndexOf('. '), win.lastIndexOf('! '), win.lastIndexOf('? '));
    if (cut < max / 2) cut = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '));
    if (cut < max / 2) cut = win.lastIndexOf(' ');
    if (cut <= 0) cut = max - 1;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

let edgeChain: Promise<unknown> = Promise.resolve();
const edgeInflight = new Map<string, Promise<Buffer>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function edgeTts(text: string, rate: number, hype = false, voiceName = TTS_VOICE): Promise<Buffer> {
  const key = `${voiceName}|${rate}|${hype}|${text}`;
  const running = edgeInflight.get(key);
  if (running) return running;
  const job = edgeChain.then(async () => {
    let last: unknown;
    for (const wait of [0, 2000, 5000, 10000]) {
      if (wait) await sleep(wait);
      try {
        return await edgeTtsOnce(text, rate, hype, voiceName);
      } catch (err) {
        last = err;
      }
    }
    throw last;
  });
  edgeChain = job.catch(() => {});
  edgeInflight.set(key, job);
  job.finally(() => edgeInflight.delete(key)).catch(() => {});
  return job;
}

async function edgeTtsOnce(text: string, rate: number, hype = false, voiceName = TTS_VOICE): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text), {
      rate: `${rate >= 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%`,
      pitch: TTS_PITCH,
      volume: hype ? '+40%' : '+0%',
    });
    const chunks: Buffer[] = [];
    const read = (async () => {
      for await (const c of audioStream) chunks.push(c as Buffer);
    })();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Edge TTS timeout')), 20000));
    await Promise.race([read, timeout]);
    if (chunks.length === 0) throw new Error('Edge TTS không trả âm thanh');
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}

async function googleTts(text: string, lang = 'vi'): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const chunk of splitText(text)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
    });
    if (!r.ok) throw new Error(`Google TTS lỗi ${r.status}`);
    parts.push(Buffer.from(await r.arrayBuffer()));
  }
  return Buffer.concat(parts);
}

const ttsCache = new Map<string, Buffer>();
app.get('/api/tts', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim().slice(0, 1500);
    if (!text) return res.status(400).send('Thiếu text');
    const rate = Math.min(1.5, Math.max(0.5, Number(req.query.rate) || 1));
    const hype = req.query.hype === '1';
    const voiceName = req.query.v === 'f' ? 'vi-VN-HoaiMyNeural' : req.query.v === 'm' ? 'vi-VN-NamMinhNeural' : req.query.v === 'en' ? 'en-US-AnaNeural' : TTS_VOICE;
    const key = `${voiceName}|${rate}|${hype}|${text}`;
    let audio = ttsCache.get(key);
    let fallback = false;
    if (!audio) {
      const english = req.query.v === 'en';
      try {
        audio = await edgeTts(text, rate, hype, voiceName);
      } catch (err) {
        console.warn(`[giọng dự phòng] Edge lỗi 4 lần (${voiceName}), đọc bằng Google ${english ? 'tiếng Anh' : 'tiếng Việt'}: "${text.slice(0, 60)}"`, err instanceof Error ? err.message : err);
        audio = await googleTts(text, english ? 'en' : 'vi');
        fallback = true;
      }
      if (!fallback) ttsCache.set(key, audio);
      if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value!);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', fallback ? 'no-store' : 'public, max-age=86400');
    res.send(audio);
  } catch (err) {
    console.error('TTS lỗi:', err);
    res.status(500).json({ error: 'TTS failed' });
  }
});

app.post('/api/game/state', (req, res) => {
  broadcast('gamestate', req.body);
  if (typeof req.body?.phase === 'string') stagePhase = req.body.phase.slice(0, 20);
  res.json({ success: true });
});

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const BG_DIR = path.join(DATA_DIR, 'nen-lop');
app.use('/room-bg', express.static(BG_DIR));
const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
const saveRoom = (patch: RoomSettings) => {
  saveSettings({ room: { ...settings.room, ...patch } });
  broadcast('roomCfg', settings.room);
};
const removeRoomBg = () => {
  if (!settings.room?.bg) return;
  fs.rm(path.join(BG_DIR, path.basename(settings.room.bg)), { force: true }, () => {});
};
app.get('/api/room-settings', (_req, res) => res.json(settings.room ?? {}));
app.post('/api/room-settings', (req, res) => {
  const b = req.body || {};
  const patch: RoomSettings = {};
  if (typeof b.teacherName === 'string') {
    const name = cleanText(b.teacherName, 24);
    if (!name) return res.status(400).json({ success: false, error: 'Chưa nhập tên cô giáo' });
    patch.teacherName = name;
  }
  if (b.teacherVoice === 'nu' || b.teacherVoice === 'nam') patch.teacherVoice = b.teacherVoice;
  if (typeof b.motto === 'string') {
    const motto = cleanText(b.motto, 40);
    if (!motto) return res.status(400).json({ success: false, error: 'Chưa nhập chữ bảng đỏ' });
    patch.motto = motto;
  }
  if (typeof b.everest === 'boolean') patch.everest = b.everest;
  if (typeof b.chuong === 'boolean') patch.chuong = b.chuong;
  saveRoom(patch);
  res.json({ success: true, room: settings.room });
});

const imageExt = (b: Buffer) => {
  if (b.length > 12 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
};
app.post('/api/room-bg', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '12mb' }), (req, res) => {
  const body = req.body as Buffer;
  const ext = Buffer.isBuffer(body) ? imageExt(body) : '';
  if (!ext) return res.status(400).json({ success: false, error: 'Chỉ nhận ảnh PNG, JPG, WEBP' });
  try {
    fs.mkdirSync(BG_DIR, { recursive: true });
    const file = `nen-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(BG_DIR, file), body);
    removeRoomBg();
    saveRoom({ bg: file });
    res.json({ success: true, room: settings.room });
  } catch (err) {
    console.error('Không lưu được ảnh nền:', err);
    res.status(500).json({ success: false, error: 'Không lưu được ảnh nền' });
  }
});
app.delete('/api/room-bg', (_req, res) => {
  removeRoomBg();
  saveRoom({ bg: '' });
  res.json({ success: true, room: settings.room });
});

const SAVE_FILE = path.join(DATA_DIR, 'so-lop.json');
interface SoLop {
  used: Record<string, number>;
  week: string;
  scores: Record<string, { nickname: string; points: number }>;
  banned: Record<string, { answer: string; clue: string; at: number }>;
  attend: Record<string, { nickname: string; last: string; streak: number; total: number }>;
  today: { date: string; scores: Record<string, { nickname: string; points: number }>; talk?: Record<string, { nickname: string; points: number }>; flowers?: number; talkRoom?: string };
  life: Record<string, LifeRow>;
}
type LifeRow = { nickname: string; points: number; total: number; toan: number; su: number; meo: number; anh: number };
const LIFE_KEYS = ['points', 'total', 'toan', 'su', 'meo', 'anh'] as const;
const dayKey = (d = new Date()) => d.toLocaleDateString('sv');
const weekKey = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
};
let soLop: SoLop = { used: {}, week: weekKey(), scores: {}, banned: {}, attend: {}, today: { date: dayKey(), scores: {} }, life: {} };
try {
  soLop = { ...soLop, ...JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')) };
} catch {}

const weekTop = () => {
  if (soLop.week !== weekKey()) soLop = { ...soLop, week: weekKey(), scores: {} };
  return Object.entries(soLop.scores)
    .map(([username, v]) => ({ username, ...v }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
};

const safeKey = (k: string) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
const writeSoLop = () => {
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(soLop));
  } catch (err) {
    console.error('Không lưu được sổ lớp:', err);
  }
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const saveSoon = () => {
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    writeSoLop();
  }, 2000);
};
const todayScores = () => {
  if (soLop.today.date !== dayKey()) soLop.today = { date: dayKey(), scores: {}, talk: {}, flowers: 0 };
  return soLop.today.scores;
};

function newLiveRoom(roomId: string) {
  if (!roomId) return;
  todayScores();
  if (soLop.today.talkRoom === roomId) return;
  soLop.today.talkRoom = roomId;
  soLop.today.talk = {};
  console.log(`[Top tương tác] phiên live mới ${roomId}: làm lại bảng`);
  writeSoLop();
}
const todayTalk = () => {
  todayScores();
  return (soLop.today.talk ??= {});
};
const addScore = (book: Record<string, { nickname: string; points: number }>, key: string, nickname: unknown, points: number) => {
  const cur = Object.hasOwn(book, key) ? book[key] : { nickname: '', points: 0 };
  cur.nickname = String(nickname || cur.nickname).slice(0, 60);
  cur.points += points;
  book[key] = cur;
};

const REPORT_DIR = path.join(DATA_DIR, 'bao-cao');
type ReportRow = { id: string; answer: string; category: string; attempts: number; correct: number; at: number };
const readReport = (day: string): ReportRow[] => {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, `${day}.json`), 'utf8'));
  } catch {
    return [];
  }
};

const topOf = (book: Record<string, { nickname: string; points: number }>) =>
  Object.entries(book)
    .map(([username, v]) => ({ username, ...v }))
    .sort((x, y) => y.points - x.points)
    .slice(0, 10);
const todayTop = () => topOf(todayScores());
const talkTop = () => topOf(todayTalk());
const flowersToday = () => {
  todayScores();
  return soLop.today.flowers ?? 0;
};
const lifeOf = (key: string): LifeRow => (Object.hasOwn(soLop.life, key) ? soLop.life[key] : { nickname: '', points: 0, total: 0, toan: 0, su: 0, meo: 0, anh: 0 });

app.get('/api/game/save', (_req, res) =>
  res.json({ used: soLop.used, banned: Object.keys(soLop.banned), weekTop: weekTop(), todayTop: todayTop(), talkTop: talkTop(), flowersToday: flowersToday() }),
);

app.post('/api/game/save', (req, res) => {
  const { used, week, banned, report, life, talk, flowers } = req.body || {};
  if (typeof flowers === 'number' && Number.isFinite(flowers) && flowers > 0) {
    todayScores();
    soLop.today.flowers = (soLop.today.flowers ?? 0) + Math.min(1_000_000, Math.round(flowers));
  }
  if (Array.isArray(life)) {
    for (const e of life.slice(0, 2000)) {
      if (!e || typeof e.username !== 'string') continue;
      const key = e.username.slice(0, 100);
      if (!safeKey(key)) continue;
      const cur = lifeOf(key);
      cur.nickname = String(e.nickname || cur.nickname).slice(0, 60);
      for (const k of LIFE_KEYS) cur[k] += Math.max(0, Math.min(5000, Math.round(Number(e[k]) || 0)));
      soLop.life[key] = cur;
    }
  }
  if (Array.isArray(talk)) {
    for (const e of talk.slice(0, 5000)) {
      if (!e || typeof e.username !== 'string' || !safeKey(e.username.slice(0, 100))) continue;
      addScore(todayTalk(), e.username.slice(0, 100), e.nickname, Math.max(0, Math.min(10_000, Math.round(Number(e.points) || 0))));
    }
  }
  weekTop();
  if (Array.isArray(used)) for (const id of used.slice(0, 500)) if (typeof id === 'string' && safeKey(id)) soLop.used[id.slice(0, 200)] = Date.now();
  if (Array.isArray(week)) {
    for (const e of week.slice(0, 2000)) {
      if (!e || typeof e.username !== 'string' || typeof e.points !== 'number' || !Number.isFinite(e.points)) continue;
      const key = e.username.slice(0, 100);
      if (!safeKey(key)) continue;
      const pts = Math.max(0, Math.min(1000, Math.round(e.points)));
      addScore(soLop.scores, key, e.nickname, pts);
      addScore(todayScores(), key, e.nickname, pts);
    }
  }
  if (Array.isArray(banned)) {
    for (const b of banned.slice(0, 50)) {
      if (!b || typeof b.id !== 'string' || !safeKey(b.id)) continue;
      soLop.banned[b.id.slice(0, 200)] = { answer: String(b.answer ?? '').slice(0, 60), clue: String(b.clue ?? '').slice(0, 300), at: Date.now() };
    }
  }
  if (Array.isArray(report) && report.length) {
    const rows: ReportRow[] = report
      .slice(0, 200)
      .filter((r) => r && typeof r.id === 'string')
      .map((r) => ({
        id: r.id.slice(0, 200),
        answer: String(r.answer ?? '').slice(0, 60),
        category: String(r.category ?? '').slice(0, 80),
        attempts: Math.max(0, Number(r.attempts) || 0),
        correct: Math.max(0, Number(r.correct) || 0),
        at: Number(r.at) || Date.now(),
      }));
    try {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(path.join(REPORT_DIR, `${dayKey()}.json`), JSON.stringify([...readReport(dayKey()), ...rows]));
    } catch (err) {
      console.error('Không lưu được báo cáo:', err);
    }
  }
  writeSoLop();
  res.json({ weekTop: weekTop(), todayTop: todayTop(), talkTop: talkTop(), flowersToday: flowersToday() });
});

app.post('/api/game/attend', (req, res) => {
  const { username, nickname } = req.body || {};
  if (typeof username !== 'string' || !safeKey(username.slice(0, 100))) return res.status(400).json({ days: 0 });
  const key = username.slice(0, 100);
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const cur = Object.hasOwn(soLop.attend, key) ? soLop.attend[key] : { nickname: '', last: '', streak: 0, total: 0 };
  if (cur.last !== today) {
    cur.streak = cur.last === yesterday ? cur.streak + 1 : 1;
    cur.total++;
    cur.last = today;
  }
  cur.nickname = String(nickname || cur.nickname).slice(0, 60);
  soLop.attend[key] = cur;
  saveSoon();
  const { nickname: _n, ...life } = lifeOf(key);
  res.json({ days: cur.streak, total: cur.total, life });
});

let stagePhase = '';
type ViewSample = { at: number; phase: string; viewers: number };
const viewFile = (day: string) => path.join(REPORT_DIR, `${day}-xem.json`);
const readViews = (day: string): ViewSample[] => {
  try {
    return JSON.parse(fs.readFileSync(viewFile(day), 'utf8'));
  } catch {
    return [];
  }
};
let viewSamples: { day: string; rows: ViewSample[] } = { day: '', rows: [] };
setInterval(() => {
  if (!stagePhase || liveStats.viewerCount <= 0) return;
  const day = dayKey();
  if (viewSamples.day !== day) viewSamples = { day, rows: readViews(day) };
  viewSamples.rows.push({ at: Date.now(), phase: stagePhase, viewers: liveStats.viewerCount });
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(viewFile(day), JSON.stringify(viewSamples.rows));
  } catch (err) {
    console.error('Không lưu được số người xem:', err);
  }
}, 15_000);

const PHASE_NAME: Record<string, string> = {
  team: 'Chọn tổ', intro: 'Giới thiệu tiết', question: 'Đang trả lời', bonus: 'Thêm giờ (mở chữ)', reveal: 'Hiện đáp án',
  praise: 'Điểm danh giữa tiết', results: 'Tổng kết tiết', recess: 'Ra chơi', vote: 'Bình chọn chủ đề', show: 'Game lớn',
};

const viewStats = (rows: ViewSample[]) => {
  const by = new Map<string, { n: number; sum: number; delta: number; ms: number }>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const b = by.get(r.phase) ?? { n: 0, sum: 0, delta: 0, ms: 0 };
    b.n++;
    b.sum += r.viewers;
    const next = rows[i + 1];
    if (next && next.at - r.at < 60_000) {
      b.delta += next.viewers - r.viewers;
      b.ms += next.at - r.at;
    }
    by.set(r.phase, b);
  }
  return [...by].map(([phase, b]) => ({ phase, minutes: b.ms / 60_000, avg: b.sum / b.n, perMin: b.ms ? (b.delta / b.ms) * 60_000 : 0 })).sort((a, b) => a.perMin - b.perMin);
};

app.get('/bao-cao', (req, res) => {
  const day = typeof req.query.ngay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.ngay) ? req.query.ngay : dayKey();
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const rows = readReport(day);
  const words = rows.filter((r) => r.category !== 'Toán nhẩm');
  const hard = words.filter((r) => r.correct === 0 && r.attempts >= 3).sort((a, b) => b.attempts - a.attempts);
  const easy = words.filter((r) => r.attempts >= 5 && r.correct / r.attempts >= 0.9);
  const attended = Object.entries(soLop.attend).filter(([, a]) => a.last === day);
  const top = day === soLop.today.date ? Object.entries(soLop.today.scores).sort((a, b) => b[1].points - a[1].points).slice(0, 15) : [];
  const loyal = attended.sort((a, b) => b[1].streak - a[1].streak).slice(0, 15);
  const banned = Object.entries(soLop.banned).sort((a, b) => b[1].at - a[1].at);
  const views = viewStats(day === viewSamples.day ? viewSamples.rows : readViews(day));
  const list = (items: string[], empty: string) => (items.length ? `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>` : `<p class="muted">${empty}</p>`);
  res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo Lớp Học Chữ ${esc(day)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;background:#fdf8ec;color:#3b2a14}
h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:2px solid #e9d8a6;padding-bottom:4px}.muted{color:#8a7350}
.stats{display:flex;gap:12px;flex-wrap:wrap}.stat{background:#fff;border-radius:12px;padding:10px 16px;box-shadow:0 1px 3px #0002}
.stat b{display:block;font-size:28px}li{margin:4px 0}code{background:#f3e9cf;padding:1px 5px;border-radius:4px}</style></head><body>
<h1>📊 Báo cáo buổi live</h1><div class="muted">Ngày ${esc(day)} · đổi ngày: thêm <code>?ngay=YYYY-MM-DD</code> vào link</div>
<div class="stats" style="margin-top:12px">
<div class="stat"><b>${rows.length}</b>câu đã hỏi</div>
<div class="stat"><b>${attended.length}</b>bạn vào lớp</div>
<div class="stat"><b>${hard.length}</b>câu không ai đúng</div>
<div class="stat"><b>${easy.length}</b>câu quá dễ</div></div>
<h2>👀 Người xem theo từng phần</h2><p class="muted">Số người xem tăng (+) hay giảm (−) trung bình mỗi phút trong từng phần. Phần giảm nhiều nhất ở trên cùng: đó là chỗ khách rời live. Cứ 15 giây ghi 1 lần, chỉ lúc đã kết nối TikTok.</p>
${views.length ? `<table style="border-collapse:collapse;width:100%;background:#fff;border-radius:12px"><tr style="text-align:left"><th style="padding:6px">Phần</th><th>Thời gian</th><th>Xem TB</th><th>Thay đổi / phút</th></tr>${views
  .map((r) => `<tr style="border-top:1px solid #eee"><td style="padding:6px">${esc(PHASE_NAME[r.phase] ?? r.phase)}</td><td>${r.minutes.toFixed(0)} phút</td><td>${r.avg.toFixed(0)}</td><td style="color:${r.perMin < 0 ? '#b91c1c' : '#15803d'};font-weight:700">${r.perMin > 0 ? '+' : ''}${r.perMin.toFixed(1)}</td></tr>`)
  .join('')}</table>` : '<p class="muted">Chưa có số liệu (chưa kết nối TikTok hôm nay).</p>'}
<h2>❌ Câu không ai trả lời đúng</h2><p class="muted">Có nhiều bạn thử mà vẫn sai: có thể câu quá khó hoặc gợi ý chưa rõ, nên xem lại.</p>
${list(hard.map((r) => `<b>${esc(r.answer)}</b> · ${esc(r.category)} · ${r.attempts} bạn thử <code>${esc(r.id)}</code>`), 'Không có câu nào.')}
<h2>✅ Câu quá dễ (90% trở lên trả lời đúng)</h2>
${list(easy.map((r) => `<b>${esc(r.answer)}</b> · ${esc(r.category)} · ${r.correct}/${r.attempts} đúng`), 'Không có câu nào.')}
<h2>🏆 Điểm cao hôm nay</h2>
${list(top.map(([, s]) => `${esc(s.nickname)} · ${s.points} điểm`), 'Chưa có điểm (hoặc không phải hôm nay).')}
<h2>🎒 Chuyên cần (đi học nhiều ngày liền)</h2>
${list(loyal.map(([, a]) => `${esc(a.nickname)} · ${a.streak} ngày liền · tổng ${a.total} ngày`), 'Chưa có ai.')}
<h2>🚫 Câu đã bấm "Bỏ câu này"</h2><p class="muted">Sửa câu trong file <code>src/game/cau-hoi/</code> (đổi đáp án hoặc xoá dòng). Đổi đáp án là thành câu mới, game sẽ hỏi lại.</p>
${list(banned.map(([id, b]) => `<b>${esc(b.answer)}</b> · ${esc(b.clue)} <code>${esc(id)}</code>`), 'Chưa bỏ câu nào.')}
</body></html>`);
});

async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server:
        process.env.LIVE_MODE === '1'
          ? { middlewareMode: true, hmr: false, ws: false }
          : { middlewareMode: true, hmr: { port: 24682 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server chạy ở http://localhost:${PORT}  |  Link LIVE Studio: http://lvh.me:${PORT}/?view=stage`);
    if (wantUser && !process.env.DATA_DIR) {
      console.log(`[TikTok] Tự kết nối lại @${wantUser} (lần trước đang kết nối)`);
      connectTikTok(wantUser).catch((err) => scheduleReconnect(`Chưa kết nối được (${err instanceof Error ? err.message : err})`));
    }
  });
}

start();
