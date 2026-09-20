const fs = require('fs');
const path = require('path');
const dns = require('node:dns');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

// Try setting public DNS servers for Atlas SRV, safe failover
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('DNS server setting skipped:', e.message);
}

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.set('trust proxy', 1);

// ==================== CORS CONFIGURATION ====================
// EventSource and fetch from Vercel cannot use Access-Control-Allow-Origin: *
// together with Access-Control-Allow-Credentials: true. Echo the request origin
// and do not require credentials (the API is token-free JSON).
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
let allowedOrigins = ['https://aws-hackathon-six.vercel.app', '*'];
if (allowedOriginsEnv && allowedOriginsEnv !== '*') {
  allowedOrigins = allowedOriginsEnv.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowedOrigins.includes('https://aws-hackathon-six.vercel.app')) {
    allowedOrigins.push('https://aws-hackathon-six.vercel.app');
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, origin);
    }
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)?vercel\.app$/.test(origin)) {
      return callback(null, origin);
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, origin);
    }
    return callback(null, origin);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: false,
  optionsSuccessStatus: 204
};

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File-backed persistence path for fail-safe local storage
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'mealsync_store.json');

// In-memory data structures
let counters = [];
let servesLog = [];
let adminSettings = {
  defaultMaxQueueSize: 20,
  announcement: 'Welcome to Hostel Mess. Please follow your counter line and keep your token ready.'
};

// Queue Scheduling Data
let schedules = [
  {
    id: 'sched-1',
    mealName: 'Breakfast',
    startTime: '07:30',
    endTime: '09:30',
    days: 'Daily',
    counterIds: ['all'],
    enabled: true
  },
  {
    id: 'sched-2',
    mealName: 'Lunch',
    startTime: '12:30',
    endTime: '14:30',
    days: 'Daily',
    counterIds: ['all'],
    enabled: true
  },
  {
    id: 'sched-3',
    mealName: 'Evening Snacks',
    startTime: '17:00',
    endTime: '18:15',
    days: 'Daily',
    counterIds: ['counter-3'],
    enabled: true
  },
  {
    id: 'sched-4',
    mealName: 'Dinner',
    startTime: '19:30',
    endTime: '21:45',
    days: 'Daily',
    counterIds: ['all'],
    enabled: true
  }
];

const sseClients = new Set();
let countersCollection = null;
let servesCollection = null;
let settingsCollection = null;
let schedulesCollection = null;

// Track Database Connection State for monitoring & health checks
const dbState = {
  connected: false,
  provider: 'Local File Store',
  lastConnected: null,
  error: null
};

// Initial default counters for Mess
const defaultCounters = [
  {
    id: 'counter-1',
    name: 'Counter 1 (Main Hall)',
    foodType: 'veg',
    staffName: 'Chef Ramesh',
    staffRollNo: '50101',
    menu: ['Paneer Butter Masala', 'Yellow Dal Tadka', 'Jeera Rice', 'Tandoori Roti', 'Green Salad'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [40],
    avgServeSeconds: 40,
    maxQueueSize: 20,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  },
  {
    id: 'counter-2',
    name: 'Counter 2 (Special / Non-Veg)',
    foodType: 'non-veg',
    staffName: 'Chef Suresh',
    staffRollNo: '50102',
    menu: ['Butter Chicken Curry', 'Egg Curry', 'Steamed Basmati Rice', 'Butter Roti', 'Cucumber Salad'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [45],
    avgServeSeconds: 45,
    maxQueueSize: 20,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  },
  {
    id: 'counter-3',
    name: 'Counter 3 (Diet & Quick Bites)',
    foodType: 'veg',
    staffName: 'Chef Anita',
    staffRollNo: '50103',
    menu: ['Sprouted Moong Salad', 'Vegetable Dalia Khichdi', 'Curd', 'Fruit Bowl'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [30],
    avgServeSeconds: 30,
    maxQueueSize: 15,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  }
];

// Helper: load from file store
function loadLocalStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.counters && Array.isArray(parsed.counters)) counters = parsed.counters;
      if (parsed.servesLog && Array.isArray(parsed.servesLog)) servesLog = parsed.servesLog;
      if (parsed.adminSettings && typeof parsed.adminSettings === 'object') {
        adminSettings = { ...adminSettings, ...parsed.adminSettings };
      }
      if (parsed.schedules && Array.isArray(parsed.schedules)) schedules = parsed.schedules;
      console.log('Local store loaded successfully.');
      return true;
    }
  } catch (e) {
    console.warn('Error reading local store:', e.message);
  }
  return false;
}

// Helper: save to file store
function saveLocalStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data = { counters, servesLog, schedules, adminSettings, updatedAt: new Date().toISOString() };
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('Error saving local store:', e.message);
  }
}

// Connect to MongoDB Atlas (with local file backup)
async function initDatabase() {
  const loaded = loadLocalStore();
  if (!loaded || counters.length === 0) {
    counters = JSON.parse(JSON.stringify(defaultCounters));
  }

  const uri = process.env.MONGODB_URI || process.env.DB_CONNECT_STRING;
  if (!uri) {
    console.log('No MONGODB_URI or DB_CONNECT_STRING found. Running in local file-backed mode.');
    dbState.connected = false;
    dbState.provider = 'Local File Store';
    saveLocalStore();
    return;
  }

  try {
    // 10s connection and server selection timeout to handle cold-starts on Render
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
    await client.connect();
    const db = client.db('mealsync');
    countersCollection = db.collection('counters');
    servesCollection = db.collection('serves_log');
    settingsCollection = db.collection('admin_settings');
    schedulesCollection = db.collection('schedules');
    console.log('MongoDB Atlas connected successfully.');

    dbState.connected = true;
    dbState.provider = 'MongoDB Atlas';
    dbState.lastConnected = new Date().toISOString();
    dbState.error = null;

    // Sync Counters
    const docs = await countersCollection.find({}).toArray();
    if (docs && docs.length > 0) {
      counters = docs.map(({ _id, ...rest }) => rest);
    } else {
      for (const c of counters) {
        await countersCollection.updateOne({ id: c.id }, { $set: c }, { upsert: true });
      }
    }

    // Sync Serves Log
    const recentServes = await servesCollection.find({}).sort({ timestamp: -1 }).limit(1000).toArray();
    if (recentServes && recentServes.length > 0) {
      servesLog = recentServes.map(({ _id, ...rest }) => rest);
    }

    // Sync Schedules
    const dbSchedules = await schedulesCollection.find({}).toArray();
    if (dbSchedules && dbSchedules.length > 0) {
      schedules = dbSchedules.map(({ _id, ...rest }) => rest);
    } else {
      for (const s of schedules) {
        await schedulesCollection.updateOne({ id: s.id }, { $set: s }, { upsert: true });
      }
    }

    // Sync Settings
    const dbSettings = await settingsCollection.findOne({ id: 'global_settings' });
    if (dbSettings) {
      adminSettings = { ...adminSettings, ...dbSettings };
    } else {
      await settingsCollection.updateOne({ id: 'global_settings' }, { $set: { id: 'global_settings', ...adminSettings } }, { upsert: true });
    }

    saveLocalStore();
  } catch (err) {
    console.warn('MongoDB connection unavailable. Using resilient local file storage:', err.message);
    dbState.connected = false;
    dbState.provider = 'Local File Store (Fallback)';
    dbState.error = err.message;

    if (!counters || counters.length === 0) {
      counters = JSON.parse(JSON.stringify(defaultCounters));
    }
    saveLocalStore();
  }
}

async function saveCounter(counter) {
  saveLocalStore();
  if (!countersCollection) return;
  try {
    await countersCollection.updateOne({ id: counter.id }, { $set: counter }, { upsert: true });
  } catch (e) {
    console.warn('MongoDB save error:', e.message);
  }
}

async function recordServeLog(entry) {
  servesLog.unshift(entry);
  if (servesLog.length > 5000) servesLog.pop();
  saveLocalStore();

  if (!servesCollection) return;
  try {
    await servesCollection.insertOne({ ...entry });
  } catch (e) {
    console.warn('MongoDB serve log insert error:', e.message);
  }
}

async function saveSettings() {
  saveLocalStore();
  if (!settingsCollection) return;
  try {
    await settingsCollection.updateOne({ id: 'global_settings' }, { $set: { id: 'global_settings', ...adminSettings } }, { upsert: true });
  } catch (e) {
    console.warn('MongoDB settings save error:', e.message);
  }
}

async function saveSchedule(schedule) {
  saveLocalStore();
  if (!schedulesCollection) return;
  try {
    await schedulesCollection.updateOne({ id: schedule.id }, { $set: schedule }, { upsert: true });
  } catch (e) {
    console.warn('MongoDB schedule save error:', e.message);
  }
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

const getWait = (pos, avg) => Math.max(0, (pos - 1) * (avg || 40));

// Compute currently active meal session and upcoming slot
function getCurrentScheduleStatus() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  let activeSlot = null;
  let upcomingSlot = null;

  const enabledList = schedules.filter(s => s.enabled);
  for (const s of enabledList) {
    if (currentTime >= s.startTime && currentTime <= s.endTime) {
      activeSlot = s;
      break;
    }
  }

  if (!activeSlot) {
    // Find next upcoming
    const futureSlots = enabledList.filter(s => s.startTime > currentTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (futureSlots.length > 0) {
      upcomingSlot = futureSlots[0];
    } else if (enabledList.length > 0) {
      // First slot next day
      upcomingSlot = enabledList.sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    }
  }

  return { activeSlot, upcomingSlot, currentTime };
}

// ==================== SYSTEM & HEALTH ENDPOINTS ====================

// Root Health & Information Endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'MealSync API',
    status: 'online',
    version: '1.0.0',
    description: 'Smart Hostel Mess Queue & Dining Management Backend API',
    cors: 'enabled',
    database: dbState,
    activeCounters: counters.filter(c => c.status === 'active').length,
    activeClients: sseClients.size,
    documentation: 'See README.md for complete API documentation and deployment guides'
  });
});

function healthPayload() {
  return {
    ok: true,
    service: 'MealSync API',
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: dbState,
    activeSseClients: sseClients.size,
    countersTotal: counters.length,
    servesLogged: servesLog.length
  };
}

// Dedicated Health Check endpoint (for Render health check monitor)
app.get('/api/health', (req, res) => {
  res.status(200).json(healthPayload());
});

app.get('/health', (req, res) => {
  res.status(200).json(healthPayload());
});

const API_CATALOG = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/api' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/stream' },
  { method: 'GET', path: '/api/settings' },
  { method: 'GET', path: '/api/schedules' },
  { method: 'GET', path: '/api/counters' },
  { method: 'POST', path: '/api/counters' },
  { method: 'POST', path: '/api/counters/:id/join' },
  { method: 'POST', path: '/api/counters/:id/leave' },
  { method: 'POST', path: '/api/counters/:id/serve-next' },
  { method: 'POST', path: '/api/counters/:id/close' },
  { method: 'GET', path: '/api/student-status' },
  { method: 'POST', path: '/api/auth/student-login' },
  { method: 'POST', path: '/api/auth/staff-login' },
  { method: 'POST', path: '/api/auth/admin-login' },
  { method: 'POST', path: '/api/admin/schedules' },
  { method: 'POST', path: '/api/admin/schedules/:id/toggle' },
  { method: 'DELETE', path: '/api/admin/schedules/:id' },
  { method: 'GET', path: '/api/admin/overview' },
  { method: 'GET', path: '/api/admin/settings' },
  { method: 'POST', path: '/api/admin/settings' },
  { method: 'PUT', path: '/api/admin/settings' },
  { method: 'PATCH', path: '/api/admin/settings' },
  { method: 'POST', path: '/api/admin/counters/:id/settings' },
  { method: 'POST', path: '/api/admin/counters/:id/reopen' },
  { method: 'DELETE', path: '/api/admin/counters/:id' },
  { method: 'POST', path: '/api/admin/counters/:id/kick' },
  { method: 'POST', path: '/api/admin/counters/:id/clear' },
  { method: 'GET', path: '/api/admin/serves' },
  { method: 'GET', path: '/api/admin/export-serves.csv' }
];

app.get('/api', (req, res) => {
  res.json({
    success: true,
    service: 'MealSync API',
    endpoints: API_CATALOG
  });
});

// ==================== SSE EVENT STREAM ====================
app.get('/api/stream', (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ==================== AUTHENTICATION ====================

// 1. Student Login: Name + 10-digit Registration Number
app.post('/api/auth/student-login', (req, res) => {
  const name = String(req.body.studentName || '').trim();
  const regNo = String(req.body.studentId || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Student full name is required.' });
  if (!/^\d{10}$/.test(regNo)) return res.status(400).json({ success: false, message: 'Student Registration Number must be exactly 10 digits.' });
  res.json({ success: true, student: { studentName: name, studentId: regNo, role: 'student' } });
});

// 2. Staff Login: Name + 5-digit Staff Roll No / Employee ID
app.post('/api/auth/staff-login', (req, res) => {
  const name = String(req.body.staffName || '').trim();
  const staffRollNo = String(req.body.staffRollNo || req.body.staffId || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Staff name is required.' });
  if (!/^\d{5}$/.test(staffRollNo)) return res.status(400).json({ success: false, message: 'Staff Roll Number must be exactly 5 digits.' });
  res.json({ success: true, staff: { staffName: name, staffRollNo, role: 'staff' } });
});

// 3. Admin Login: Name + 5-digit Admin Code
app.post('/api/auth/admin-login', (req, res) => {
  const name = String(req.body.adminName || '').trim();
  const adminCode = String(req.body.adminCode || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Admin name is required.' });
  if (!/^\d{5}$/.test(adminCode)) return res.status(400).json({ success: false, message: 'Admin security code must be exactly 5 digits.' });
  res.json({ success: true, admin: { adminName: name, adminCode, role: 'admin' } });
});

// System Settings
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: adminSettings });
});

app.get('/api/admin/settings', (req, res) => {
  res.json({ success: true, settings: adminSettings });
});

// ==================== QUEUE SCHEDULING ====================

// Public Schedules list with current active session
app.get('/api/schedules', (req, res) => {
  const status = getCurrentScheduleStatus();
  res.json({
    success: true,
    schedules,
    activeSlot: status.activeSlot,
    upcomingSlot: status.upcomingSlot,
    currentTime: status.currentTime
  });
});

// Admin Add Schedule
app.post('/api/admin/schedules', async (req, res) => {
  const { mealName, startTime, endTime, days, counterIds } = req.body;
  if (!mealName || !startTime || !endTime) {
    return res.status(400).json({ success: false, message: 'Meal name, start time, and end time are required.' });
  }

  const newSchedule = {
    id: 'sched-' + Date.now(),
    mealName: mealName.trim(),
    startTime: startTime.trim(),
    endTime: endTime.trim(),
    days: days && days.trim() ? days.trim() : 'Daily',
    counterIds: Array.isArray(counterIds) && counterIds.length > 0 ? counterIds : ['all'],
    enabled: true
  };

  schedules.push(newSchedule);
  await saveSchedule(newSchedule);
  broadcast('schedules_updated', newSchedule);
  res.json({ success: true, schedule: newSchedule });
});

// Admin Toggle Schedule
app.post('/api/admin/schedules/:id/toggle', async (req, res) => {
  const sched = schedules.find(s => s.id === req.params.id);
  if (!sched) return res.status(404).json({ success: false, message: 'Schedule slot not found.' });

  sched.enabled = !sched.enabled;
  await saveSchedule(sched);
  broadcast('schedules_updated', sched);
  res.json({ success: true, schedule: sched });
});

// Admin Delete Schedule
app.delete('/api/admin/schedules/:id', async (req, res) => {
  const idx = schedules.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Schedule slot not found.' });

  const removed = schedules.splice(idx, 1)[0];
  saveLocalStore();
  if (schedulesCollection) {
    try { await schedulesCollection.deleteOne({ id: req.params.id }); } catch (e) { }
  }
  broadcast('schedules_updated', { deletedId: req.params.id });
  res.json({ success: true, message: `Removed "${removed.mealName}" schedule.` });
});

// ==================== COUNTER OPERATIONS ====================

// Get all active counters
app.get('/api/counters', (req, res) => {
  const list = counters.filter(c => c.status === 'active').map(c => {
    const queue = (c.queue || []).map((s, i) => ({
      ...s,
      position: i + 1,
      estWaitSeconds: getWait(i + 1, c.avgServeSeconds),
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - s.joinedAt) / 1000))
    }));
    const maxQ = c.maxQueueSize || adminSettings.defaultMaxQueueSize || 20;
    return {
      id: c.id,
      name: c.name,
      foodType: c.foodType,
      staffName: c.staffName,
      staffRollNo: c.staffRollNo || '50101',
      menu: c.menu || [],
      queue,
      queueLength: queue.length,
      maxQueueSize: maxQ,
      isFull: queue.length >= maxQ,
      avgServeSeconds: c.avgServeSeconds || 40,
      totalServed: (c.servedHistory || []).length,
      nextWaitEstimateSeconds: getWait(queue.length + 1, c.avgServeSeconds),
      status: c.status
    };
  });

  const schedStatus = getCurrentScheduleStatus();

  res.json({
    success: true,
    counters: list,
    serverTime: Date.now(),
    announcement: adminSettings.announcement,
    activeSlot: schedStatus.activeSlot,
    upcomingSlot: schedStatus.upcomingSlot
  });
});

// Create New Line / Counter
app.post('/api/counters', async (req, res) => {
  const { name, foodType, menu, staffName, staffRollNo, maxQueueSize } = req.body;
  if (!name || !foodType) return res.status(400).json({ success: false, message: 'Counter name and food type are required.' });

  const roll = staffRollNo && /^\d{5}$/.test(String(staffRollNo).trim()) ? String(staffRollNo).trim() : '50101';
  const items = Array.isArray(menu) ? menu : String(menu || '').split(',').map(m => m.trim()).filter(Boolean);
  const maxQ = parseInt(maxQueueSize, 10) > 0 ? parseInt(maxQueueSize, 10) : (adminSettings.defaultMaxQueueSize || 20);

  const newCounter = {
    id: 'counter-' + Date.now(),
    name: name.trim(),
    foodType: foodType.toLowerCase() === 'non-veg' ? 'non-veg' : 'veg',
    staffName: (staffName && staffName.trim()) || 'Mess Staff',
    staffRollNo: roll,
    menu: items,
    queue: [],
    servedHistory: [],
    recentServeDurations: [40],
    avgServeSeconds: 40,
    maxQueueSize: maxQ,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  };

  counters.push(newCounter);
  await saveCounter(newCounter);
  broadcast('counters_updated', { id: newCounter.id });
  res.json({ success: true, counter: newCounter });
});

// Join Queue
app.post('/api/counters/:id/join', async (req, res) => {
  const regNo = String(req.body.studentId || '').trim();
  const name = String(req.body.studentName || '').trim();

  if (!name || !regNo) return res.status(400).json({ success: false, message: 'Name and 10-digit registration number required.' });
  if (!/^\d{10}$/.test(regNo)) return res.status(400).json({ success: false, message: 'Registration number must be exactly 10 digits.' });

  const target = counters.find(c => c.id === req.params.id && c.status === 'active');
  if (!target) return res.status(404).json({ success: false, message: 'Mess counter is not available or has been closed.' });

  if (target.queue.some(s => s.studentId === regNo)) {
    const existingPos = target.queue.findIndex(s => s.studentId === regNo) + 1;
    return res.json({ success: true, message: `You are already in this queue (Position #${existingPos}).`, counterId: target.id, position: existingPos });
  }

  const maxCapacity = target.maxQueueSize || adminSettings.defaultMaxQueueSize || 20;
  if (target.queue.length >= maxCapacity) {
    return res.status(400).json({
      success: false,
      message: `"${target.name}" is full (Capacity: ${maxCapacity} students). Please wait a moment or choose another line.`
    });
  }

  let switchedFrom = null;
  for (const c of counters) {
    const idx = c.queue.findIndex(s => s.studentId === regNo);
    if (idx !== -1) {
      switchedFrom = c.name;
      c.queue.splice(idx, 1);
      await saveCounter(c);
    }
  }

  target.queue.push({ studentId: regNo, studentName: name, joinedAt: Date.now() });
  await saveCounter(target);

  const pos = target.queue.length;
  broadcast('queue_updated', { studentId: regNo, counterId: target.id, position: pos });

  res.json({
    success: true,
    message: switchedFrom ? `Switched from "${switchedFrom}" to "${target.name}".` : `Joined "${target.name}".`,
    counterId: target.id,
    counterName: target.name,
    position: pos,
    estWaitSeconds: getWait(pos, target.avgServeSeconds)
  });
});

// Leave Queue
app.post('/api/counters/:id/leave', async (req, res) => {
  const regNo = String(req.body.studentId || '').trim();
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });

  const idx = counter.queue.findIndex(s => s.studentId === regNo);
  if (idx !== -1) {
    counter.queue.splice(idx, 1);
    await saveCounter(counter);
    broadcast('queue_updated', { studentId: regNo, counterId: counter.id });
  }
  res.json({ success: true, message: `Left queue at ${counter.name}.` });
});

// Serve Next Student & Log into Database
app.post('/api/counters/:id/serve-next', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id && c.status === 'active');
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found or inactive.' });
  if (!counter.queue || counter.queue.length === 0) return res.status(400).json({ success: false, message: 'Queue is empty.' });

  const served = counter.queue.shift();
  const now = Date.now();
  const duration = counter.lastServeTime
    ? Math.max(15, Math.min(120, Math.round((now - counter.lastServeTime) / 1000)))
    : Math.max(15, Math.min(90, Math.round((now - served.joinedAt) / 1000)));

  const waitTime = Math.max(0, Math.round((now - served.joinedAt) / 1000));

  counter.lastServeTime = now;
  if (!counter.servedHistory) counter.servedHistory = [];
  counter.servedHistory.push({ ...served, servedAt: now, durationSeconds: duration });

  if (!counter.recentServeDurations) counter.recentServeDurations = [];
  counter.recentServeDurations.push(duration);
  if (counter.recentServeDurations.length > 8) counter.recentServeDurations.shift();

  const total = counter.recentServeDurations.reduce((a, b) => a + b, 0);
  counter.avgServeSeconds = Math.max(15, Math.round(total / counter.recentServeDurations.length));

  await saveCounter(counter);

  // Permanent Database Audit Log Entry
  const serveEntry = {
    serveId: 'SRV-' + now + '-' + Math.floor(Math.random() * 1000),
    counterId: counter.id,
    counterName: counter.name,
    foodType: counter.foodType,
    studentName: served.studentName,
    studentId: served.studentId,
    staffName: counter.staffName,
    staffRollNo: counter.staffRollNo || '50101',
    durationSeconds: duration,
    waitTimeSeconds: waitTime,
    timestamp: now,
    servedAt: new Date(now).toLocaleString('en-IN')
  };

  await recordServeLog(serveEntry);

  broadcast('student_served', {
    counterId: counter.id,
    counterName: counter.name,
    servedStudent: served,
    durationSeconds: duration,
    remainingQueueLength: counter.queue.length
  });

  res.json({
    success: true,
    servedStudent: served,
    durationSeconds: duration,
    avgServeSeconds: counter.avgServeSeconds,
    remainingInQueue: counter.queue.length
  });
});

// Close Counter
app.post('/api/counters/:id/close', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });

  counter.status = 'closed';
  await saveCounter(counter);
  broadcast('counters_updated', { id: counter.id, status: 'closed' });
  res.json({ success: true, message: `Closed "${counter.name}".` });
});

// Student Status Check
app.get('/api/student-status', (req, res) => {
  const regNo = String(req.query.studentId || '').trim();
  if (!regNo) return res.status(400).json({ inQueue: false });

  for (const c of counters) {
    if (c.status !== 'active') continue;
    const idx = c.queue.findIndex(s => s.studentId === regNo);
    if (idx !== -1) {
      const s = c.queue[idx];
      return res.json({
        inQueue: true,
        counter: {
          id: c.id,
          name: c.name,
          foodType: c.foodType,
          menu: c.menu,
          staffName: c.staffName,
          staffRollNo: c.staffRollNo || '50101',
          avgServeSeconds: c.avgServeSeconds,
          maxQueueSize: c.maxQueueSize || adminSettings.defaultMaxQueueSize || 20
        },
        student: {
          studentId: s.studentId,
          studentName: s.studentName,
          joinedAt: s.joinedAt,
          position: idx + 1,
          estWaitSeconds: getWait(idx + 1, c.avgServeSeconds),
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - s.joinedAt) / 1000))
        }
      });
    }
  }
  res.json({ inQueue: false });
});

// ==================== ADMIN MANAGEMENT ENDPOINTS ====================

// Admin Overview
app.get('/api/admin/overview', (req, res) => {
  let totalQueued = 0;
  let totalServedHistory = 0;
  let paceSum = 0;
  let activeCount = 0;

  const enrichedCounters = counters.map(c => {
    const qLen = (c.queue || []).length;
    totalQueued += qLen;
    totalServedHistory += (c.servedHistory || []).length;
    if (c.status === 'active') {
      activeCount++;
      paceSum += (c.avgServeSeconds || 40);
    }
    return {
      ...c,
      queueLength: qLen,
      maxQueueSize: c.maxQueueSize || adminSettings.defaultMaxQueueSize || 20
    };
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayCount = servesLog.filter(s => s.timestamp >= startOfDay.getTime()).length;

  res.json({
    success: true,
    stats: {
      totalCounters: counters.length,
      activeCounters: activeCount,
      closedCounters: counters.length - activeCount,
      totalQueued,
      totalServesAllTime: servesLog.length,
      servesToday: todayCount,
      avgServingPace: activeCount > 0 ? Math.round(paceSum / activeCount) : 40,
      defaultMaxQueueSize: adminSettings.defaultMaxQueueSize,
      announcement: adminSettings.announcement
    },
    counters: enrichedCounters,
    schedules,
    recentServes: servesLog.slice(0, 20)
  });
});

async function updateAdminSettings(req, res) {
  const { defaultMaxQueueSize, announcement } = req.body || {};
  if (defaultMaxQueueSize && parseInt(defaultMaxQueueSize, 10) > 0) {
    adminSettings.defaultMaxQueueSize = parseInt(defaultMaxQueueSize, 10);
  }
  if (typeof announcement === 'string') {
    adminSettings.announcement = announcement.trim();
  }

  await saveSettings();
  broadcast('settings_updated', adminSettings);
  broadcast('counters_updated', {});
  res.json({ success: true, settings: adminSettings });
}

// Update Global Admin Settings
app.post('/api/admin/settings', updateAdminSettings);
app.put('/api/admin/settings', updateAdminSettings);
app.patch('/api/admin/settings', updateAdminSettings);

// Update Per-Counter Max Queue Size
app.post('/api/admin/counters/:id/settings', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });

  const { maxQueueSize, name, menu, staffName, staffRollNo } = req.body;
  if (maxQueueSize && parseInt(maxQueueSize, 10) > 0) {
    counter.maxQueueSize = parseInt(maxQueueSize, 10);
  }
  if (name) counter.name = name.trim();
  if (staffName) counter.staffName = staffName.trim();
  if (staffRollNo && /^\d{5}$/.test(staffRollNo)) counter.staffRollNo = staffRollNo.trim();
  if (menu) {
    counter.menu = Array.isArray(menu) ? menu : String(menu).split(',').map(s => s.trim()).filter(Boolean);
  }

  await saveCounter(counter);
  broadcast('counters_updated', { id: counter.id });
  res.json({ success: true, counter });
});

// Reopen a Closed Counter
app.post('/api/admin/counters/:id/reopen', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });

  counter.status = 'active';
  await saveCounter(counter);
  broadcast('counters_updated', { id: counter.id, status: 'active' });
  res.json({ success: true, message: `Counter "${counter.name}" reopened successfully.` });
});

// Delete Counter Permanently
app.delete('/api/admin/counters/:id', async (req, res) => {
  const idx = counters.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Counter not found.' });

  const removed = counters.splice(idx, 1)[0];
  saveLocalStore();
  if (countersCollection) {
    try { await countersCollection.deleteOne({ id: req.params.id }); } catch (e) { }
  }
  broadcast('counters_updated', { id: req.params.id, deleted: true });
  res.json({ success: true, message: `Deleted counter "${removed.name}".` });
});

// Moderate Queue: Kick a student
app.post('/api/admin/counters/:id/kick', async (req, res) => {
  const regNo = String(req.body.studentId || '').trim();
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });

  const idx = counter.queue.findIndex(s => s.studentId === regNo);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Student not in this queue.' });

  const removed = counter.queue.splice(idx, 1)[0];
  await saveCounter(counter);
  broadcast('queue_updated', { counterId: counter.id, kickedStudentId: regNo });
  res.json({ success: true, message: `Removed ${removed.studentName} (${regNo}) from ${counter.name}.` });
});

// Moderate Queue: Clear whole queue
app.post('/api/admin/counters/:id/clear', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });

  const count = counter.queue.length;
  counter.queue = [];
  await saveCounter(counter);
  broadcast('queue_updated', { counterId: counter.id, cleared: true });
  res.json({ success: true, message: `Cleared ${count} student(s) from ${counter.name}.` });
});

// Serve Audit Logs
app.get('/api/admin/serves', (req, res) => {
  const { counterId, foodType, query, limit = 100 } = req.query;
  let filtered = [...servesLog];

  if (counterId) {
    filtered = filtered.filter(s => s.counterId === counterId);
  }
  if (foodType && foodType !== 'all') {
    filtered = filtered.filter(s => s.foodType === foodType);
  }
  if (query) {
    const q = String(query).toLowerCase();
    filtered = filtered.filter(s =>
      (s.studentName && s.studentName.toLowerCase().includes(q)) ||
      (s.studentId && s.studentId.includes(q)) ||
      (s.staffName && s.staffName.toLowerCase().includes(q)) ||
      (s.staffRollNo && s.staffRollNo.includes(q)) ||
      (s.counterName && s.counterName.toLowerCase().includes(q))
    );
  }

  const result = filtered.slice(0, parseInt(limit, 10) || 100);
  res.json({ success: true, total: filtered.length, serves: result });
});

// Export Serves Log to CSV
app.get('/api/admin/export-serves.csv', (req, res) => {
  const headers = ['Serve ID', 'Timestamp', 'Counter Name', 'Food Type', 'Student Name', 'Registration Number', 'Staff Name', 'Staff Roll No', 'Duration (Seconds)', 'Queue Wait (Seconds)'];
  const rows = servesLog.map(s => [
    `"${s.serveId || ''}"`,
    `"${s.servedAt || new Date(s.timestamp).toISOString()}"`,
    `"${(s.counterName || '').replace(/"/g, '""')}"`,
    `"${s.foodType || ''}"`,
    `"${(s.studentName || '').replace(/"/g, '""')}"`,
    `"${s.studentId || ''}"`,
    `"${(s.staffName || '').replace(/"/g, '""')}"`,
    `"${s.staffRollNo || ''}"`,
    s.durationSeconds || 0,
    s.waitTimeSeconds || 0
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Disposition', `attachment; filename="mealsync_serve_logs_${Date.now()}.csv"`);
  res.send(csvContent);
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body')) {
    return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  }
  return next(err);
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Unknown endpoint ${req.method} ${req.path}`,
    service: 'MealSync API',
    endpoints: API_CATALOG
  });
});

// Start Server
app.listen(PORT, HOST, async () => {
  console.log(`MealSync API Server listening on http://${HOST}:${PORT}`);
  console.log(`CORS enabled for origins: ${Array.isArray(allowedOrigins) ? allowedOrigins.join(', ') : allowedOrigins}`);
  await initDatabase();
});
