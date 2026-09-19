const dns = require('node:dns');
const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

// Public DNS servers for resolving MongoDB Atlas SRV connection strings
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'assets')));

// In-memory counter cache & SSE clients
let counters = [];
const sseClients = new Set();
let countersCollection = null;

// Initial standard mess lines
const defaultCounters = [
  {
    id: 'counter-1',
    name: 'Counter 1 (Main Hall)',
    foodType: 'veg',
    staffName: 'Chef Ramesh',
    menu: ['Paneer Butter Masala', 'Yellow Dal Tadka', 'Jeera Rice', 'Tandoori Roti', 'Green Salad'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [40],
    avgServeSeconds: 40,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  },
  {
    id: 'counter-2',
    name: 'Counter 2 (Special Dining)',
    foodType: 'non-veg',
    staffName: 'Chef Mohan',
    menu: ['Chicken Curry', 'Egg Bhurji', 'Butter Naan', 'Steamed Rice', 'Onion Raita'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [45],
    avgServeSeconds: 45,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  }
];

// Connect to MongoDB Atlas (with local in-memory fallback)
async function initDatabase() {
  const uri = process.env.DB_CONNECT_STRING;
  if (!uri) {
    counters = JSON.parse(JSON.stringify(defaultCounters));
    return;
  }
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    countersCollection = client.db('mealsync').collection('counters');
    console.log('MongoDB connected.');

    const docs = await countersCollection.find({ status: 'active' }).toArray();
    if (docs && docs.length > 0) {
      counters = docs.map(({ _id, ...rest }) => rest);
    } else {
      counters = JSON.parse(JSON.stringify(defaultCounters));
      for (const c of counters) await countersCollection.updateOne({ id: c.id }, { $set: c }, { upsert: true });
    }
  } catch (err) {
    console.warn('Database fallback to local memory:', err.message);
    counters = JSON.parse(JSON.stringify(defaultCounters));
  }
}

async function saveCounter(counter) {
  if (!countersCollection) return;
  try {
    await countersCollection.updateOne({ id: counter.id }, { $set: counter }, { upsert: true });
  } catch (e) {}
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (e) { sseClients.delete(client); }
  }
}

const getWait = (pos, avg) => Math.max(0, (pos - 1) * (avg || 40));

// ==================== ROUTES ====================

// Real-time Event Stream
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(`event: connected\ndata: {}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

// Authentication
app.post('/api/auth/student-login', (req, res) => {
  const name = String(req.body.studentName || '').trim();
  const regNo = String(req.body.studentId || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Student name required.' });
  if (!/^\d{10}$/.test(regNo)) return res.status(400).json({ success: false, message: 'Registration number must be 10 digits.' });
  res.json({ success: true, student: { studentName: name, studentId: regNo } });
});

app.post('/api/auth/staff-login', (req, res) => {
  const name = String(req.body.staffName || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'Staff name required.' });
  res.json({ success: true, staff: { staffName: name } });
});

// Counters
app.get('/api/counters', (req, res) => {
  const list = counters.filter(c => c.status === 'active').map(c => {
    const queue = (c.queue || []).map((s, i) => ({
      ...s,
      position: i + 1,
      estWaitSeconds: getWait(i + 1, c.avgServeSeconds),
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - s.joinedAt) / 1000))
    }));
    return {
      id: c.id,
      name: c.name,
      foodType: c.foodType,
      staffName: c.staffName,
      menu: c.menu || [],
      queue,
      queueLength: queue.length,
      avgServeSeconds: c.avgServeSeconds || 40,
      totalServed: (c.servedHistory || []).length,
      nextWaitEstimateSeconds: getWait(queue.length + 1, c.avgServeSeconds)
    };
  });
  res.json({ success: true, counters: list, serverTime: Date.now() });
});

// Create Line
app.post('/api/counters', async (req, res) => {
  const { name, foodType, menu, staffName } = req.body;
  if (!name || !foodType) return res.status(400).json({ success: false, message: 'Name and food type required.' });

  const items = Array.isArray(menu) ? menu : String(menu || '').split(',').map(m => m.trim()).filter(Boolean);
  const newCounter = {
    id: 'counter-' + Date.now(),
    name: name.trim(),
    foodType: foodType.toLowerCase() === 'non-veg' ? 'non-veg' : 'veg',
    staffName: (staffName && staffName.trim()) || 'Mess Staff',
    menu: items.length > 0 ? items : ['Standard Mess Meal'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [40],
    avgServeSeconds: 40,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  };

  counters.push(newCounter);
  await saveCounter(newCounter);
  broadcast('counters_updated', { id: newCounter.id });
  res.json({ success: true, counter: newCounter });
});

// Join Queue (with auto-exit from any other line & bug-safe duplicate check)
app.post('/api/counters/:id/join', async (req, res) => {
  const regNo = String(req.body.studentId || '').trim();
  const name = String(req.body.studentName || '').trim();

  if (!name || !regNo) return res.status(400).json({ success: false, message: 'Name and registration number required.' });
  if (!/^\d{10}$/.test(regNo)) return res.status(400).json({ success: false, message: 'Registration number must be 10 digits.' });

  const target = counters.find(c => c.id === req.params.id && c.status === 'active');
  if (!target) return res.status(404).json({ success: false, message: 'Counter not found.' });

  // Guard: if already in this exact counter, keep current spot!
  if (target.queue.some(s => s.studentId === regNo)) {
    return res.json({ success: true, message: 'You are already in this queue.', counterId: target.id });
  }

  // Automatic exit from any other line
  let switchedFrom = null;
  for (const c of counters) {
    const idx = c.queue.findIndex(s => s.studentId === regNo);
    if (idx !== -1) {
      switchedFrom = c.name;
      c.queue.splice(idx, 1);
      saveCounter(c);
    }
  }

  // Elapsed time starts strictly at 0 sec
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
  res.json({ success: true, message: `Left ${counter.name}.` });
});

// Serve Next Student (Dequeue & calculate JS serving duration)
app.post('/api/counters/:id/serve-next', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id && c.status === 'active');
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });
  if (!counter.queue || counter.queue.length === 0) return res.status(400).json({ success: false, message: 'Queue is empty.' });

  const served = counter.queue.shift();
  const now = Date.now();
  const duration = counter.lastServeTime 
    ? Math.max(15, Math.min(120, Math.round((now - counter.lastServeTime) / 1000)))
    : Math.max(15, Math.min(90, Math.round((now - served.joinedAt) / 1000)));

  counter.lastServeTime = now;
  if (!counter.servedHistory) counter.servedHistory = [];
  counter.servedHistory.push({ ...served, servedAt: now, durationSeconds: duration });

  if (!counter.recentServeDurations) counter.recentServeDurations = [];
  counter.recentServeDurations.push(duration);
  if (counter.recentServeDurations.length > 8) counter.recentServeDurations.shift();

  const total = counter.recentServeDurations.reduce((a, b) => a + b, 0);
  counter.avgServeSeconds = Math.max(15, Math.round(total / counter.recentServeDurations.length));

  await saveCounter(counter);
  broadcast('student_served', { counterId: counter.id, counterName: counter.name, servedStudent: served, durationSeconds: duration });

  res.json({ success: true, servedStudent: served, durationSeconds: duration, avgServeSeconds: counter.avgServeSeconds });
});

// Close Counter
app.post('/api/counters/:id/close', async (req, res) => {
  const counter = counters.find(c => c.id === req.params.id);
  if (!counter) return res.status(404).json({ success: false, message: 'Counter not found.' });
  counter.status = 'closed';
  await saveCounter(counter);
  broadcast('counters_updated', { id: counter.id });
  res.json({ success: true, message: `Closed "${counter.name}".` });
});

// Student Status
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
        counter: { id: c.id, name: c.name, foodType: c.foodType, menu: c.menu, staffName: c.staffName, avgServeSeconds: c.avgServeSeconds },
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, HOST, async () => {
  console.log(`MealSync server listening on http://${HOST}:${PORT}`);
  await initDatabase();
});