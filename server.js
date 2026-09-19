const dns = require('node:dns');
const express = require('express');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');

// Configure public DNS servers for resolving MongoDB Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'assets')));

// MongoDB Client Setup
const uri = process.env.DB_CONNECT_STRING;
let db = null;
let countersCollection = null;

// In-memory state for lightning-fast queue updates, zero-latency reads, and SSE broadcast
let counters = [];
const sseClients = new Set();

// Default seed data with 10-digit student registration numbers
const defaultSeedCounters = [
  {
    id: 'counter-1',
    name: 'Counter 1 - Deluxe Veg Thali',
    foodType: 'veg',
    staffName: 'Chef Ramesh',
    menu: ['Paneer Butter Masala', 'Yellow Dal Tadka', 'Jeera Rice', 'Tandoori Roti', 'Boondi Raita', 'Gulab Jamun'],
    queue: [
      { studentId: '2102090101', studentName: 'Aarav Sharma', joinedAt: Date.now() - 140000 },
      { studentId: '2102090102', studentName: 'Sneha Patel', joinedAt: Date.now() - 75000 }
    ],
    servedHistory: [
      { studentId: '2102090100', studentName: 'Rohan Verma', servedAt: Date.now() - 190000, durationSeconds: 42 },
      { studentId: '2102090099', studentName: 'Priya Nair', servedAt: Date.now() - 235000, durationSeconds: 38 }
    ],
    recentServeDurations: [42, 38],
    avgServeSeconds: 40,
    lastServeTime: Date.now() - 190000,
    status: 'active',
    createdAt: Date.now() - 3600000
  },
  {
    id: 'counter-2',
    name: 'Counter 2 - Special Non-Veg Feast',
    foodType: 'non-veg',
    staffName: 'Chef Mohan',
    menu: ['Chicken Dum Biryani', 'Egg Curry', 'Butter Naan', 'Mirchi Ka Salan', 'Onion Mint Raita', 'Custard'],
    queue: [
      { studentId: '2102090103', studentName: 'Vikram Singh', joinedAt: Date.now() - 110000 }
    ],
    servedHistory: [
      { studentId: '2102090098', studentName: 'Aditi Roy', servedAt: Date.now() - 160000, durationSeconds: 48 },
      { studentId: '2102090097', studentName: 'Kunal Joshi', servedAt: Date.now() - 210000, durationSeconds: 52 }
    ],
    recentServeDurations: [48, 52],
    avgServeSeconds: 50,
    lastServeTime: Date.now() - 160000,
    status: 'active',
    createdAt: Date.now() - 3600000
  }
];

// Broadcast events via Server-Sent Events (SSE)
function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      console.error('Error writing to SSE client:', err.message);
      sseClients.delete(client);
    }
  }
}

// Asynchronously sync in-memory counters to MongoDB
async function persistCountersToDb() {
  if (!countersCollection) return;
  try {
    for (const counter of counters) {
      await countersCollection.updateOne(
        { id: counter.id },
        { $set: counter },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error('Failed to persist counters to MongoDB:', err.message);
  }
}

// Initialize MongoDB & in-memory state
async function initDatabase() {
  if (!uri) {
    console.warn('DB_CONNECT_STRING missing; running purely in-memory.');
    counters = JSON.parse(JSON.stringify(defaultSeedCounters));
    return;
  }

  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
      },
      serverSelectionTimeoutMS: 6000
    });

    await client.connect();
    console.log('Successfully connected to MongoDB Atlas!');
    db = client.db('mealsync');
    countersCollection = db.collection('counters');

    const storedCounters = await countersCollection.find({ status: 'active' }).toArray();
    if (storedCounters && storedCounters.length > 0) {
      counters = storedCounters.map(c => {
        const { _id, ...rest } = c;
        return rest;
      });
      console.log(`Loaded ${counters.length} active counters from MongoDB.`);
    } else {
      console.log('Seeding initial mess counters into MongoDB...');
      counters = JSON.parse(JSON.stringify(defaultSeedCounters));
      for (const item of counters) {
        await countersCollection.updateOne({ id: item.id }, { $set: item }, { upsert: true });
      }
    }
  } catch (err) {
    console.error('MongoDB connection error, falling back to local state:', err.message);
    counters = JSON.parse(JSON.stringify(defaultSeedCounters));
  }
}

// Helper: Calculate estimated wait time for a student at position (1-based index)
function calculateEstimatedWait(position, avgServeSeconds) {
  const avg = avgServeSeconds || 45;
  // Position 1 means the student is next or currently at the counter
  return Math.max(0, (position - 1) * avg);
}

// ==================== REST API ENDPOINTS ====================

// SSE stream for real-time queue synchronization
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// POST /api/auth/student-login - Validate student login & 10-digit registration number
app.post('/api/auth/student-login', (req, res) => {
  const { studentName, studentId } = req.body;
  if (!studentName || !studentName.trim()) {
    return res.status(400).json({ success: false, message: 'Student name is required.' });
  }
  const regNo = String(studentId || '').trim();
  if (!/^\d{10}$/.test(regNo)) {
    return res.status(400).json({
      success: false,
      message: 'Registration number must be exactly 10 digits (e.g. 2102090012).'
    });
  }
  res.json({
    success: true,
    student: {
      studentName: studentName.trim(),
      studentId: regNo
    }
  });
});

// POST /api/auth/staff-login - Validate staff login
app.post('/api/auth/staff-login', (req, res) => {
  const { staffName } = req.body;
  if (!staffName || !staffName.trim()) {
    return res.status(400).json({ success: false, message: 'Staff name is required.' });
  }
  res.json({
    success: true,
    staff: {
      staffName: staffName.trim()
    }
  });
});

// GET /api/counters - List all active counters with queue details & dynamic wait times
app.get('/api/counters', (req, res) => {
  const enrichedCounters = counters
    .filter(c => c.status === 'active')
    .map(c => {
      const queueWithTimes = (c.queue || []).map((student, idx) => {
        const position = idx + 1;
        const estWaitSeconds = calculateEstimatedWait(position, c.avgServeSeconds);
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - student.joinedAt) / 1000));
        return {
          ...student,
          position,
          estWaitSeconds,
          elapsedSeconds
        };
      });

      return {
        id: c.id,
        name: c.name,
        foodType: c.foodType,
        staffName: c.staffName,
        menu: c.menu || [],
        queue: queueWithTimes,
        queueLength: queueWithTimes.length,
        avgServeSeconds: c.avgServeSeconds || 45,
        totalServed: (c.servedHistory || []).length,
        lastServeTime: c.lastServeTime || null,
        nextWaitEstimateSeconds: calculateEstimatedWait(queueWithTimes.length + 1, c.avgServeSeconds)
      };
    });

  res.json({ success: true, counters: enrichedCounters, serverTime: Date.now() });
});

// POST /api/counters - Staff creates a new mess counter
app.post('/api/counters', async (req, res) => {
  const { name, foodType, menu, staffName } = req.body;

  if (!name || !foodType) {
    return res.status(400).json({ success: false, message: 'Line name and food type (veg/non-veg) are required.' });
  }

  // Parse menu items: accept array or comma-separated string
  let parsedMenu = [];
  if (Array.isArray(menu)) {
    parsedMenu = menu.map(m => String(m).trim()).filter(Boolean);
  } else if (typeof menu === 'string') {
    parsedMenu = menu.split(',').map(m => m.trim()).filter(Boolean);
  }

  const newCounter = {
    id: 'counter-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    name: name.trim(),
    foodType: foodType.toLowerCase() === 'non-veg' ? 'non-veg' : 'veg',
    staffName: (staffName && staffName.trim()) || 'Mess Staff',
    menu: parsedMenu.length > 0 ? parsedMenu : ['Standard Mess Meal', 'Rice', 'Dal', 'Curry'],
    queue: [],
    servedHistory: [],
    recentServeDurations: [40],
    avgServeSeconds: 40,
    lastServeTime: null,
    status: 'active',
    createdAt: Date.now()
  };

  counters.push(newCounter);
  persistCountersToDb();
  broadcastSSE('counters_updated', { action: 'created', counterId: newCounter.id });

  res.json({ success: true, message: 'Mess line created successfully!', counter: newCounter });
});

// POST /api/counters/:id/join - Student joins a counter line (with AUTOMATIC EXIT from any other line)
app.post('/api/counters/:id/join', async (req, res) => {
  const counterId = req.params.id;
  const { studentId, studentName } = req.body;

  if (!studentId || !studentName) {
    return res.status(400).json({ success: false, message: 'studentId and studentName are required.' });
  }

  // REQUIREMENT: Registration number must be exactly 10 digits
  const regNo = String(studentId).trim();
  if (!/^\d{10}$/.test(regNo)) {
    return res.status(400).json({
      success: false,
      message: 'Student registration number must be a 10-digit number (e.g. 2102090012).'
    });
  }

  const targetCounter = counters.find(c => c.id === counterId && c.status === 'active');
  if (!targetCounter) {
    return res.status(404).json({ success: false, message: 'Serving counter not found or inactive.' });
  }

  // REQUIREMENT: Joining him in a line automatically exit another!
  let previousCounterName = null;
  let previousCounterId = null;

  for (const c of counters) {
    const existingIndex = c.queue.findIndex(s => s.studentId === regNo);
    if (existingIndex !== -1) {
      previousCounterName = c.name;
      previousCounterId = c.id;
      // Remove student from old queue
      c.queue.splice(existingIndex, 1);
    }
  }

  // Add to target counter queue
  const newEntry = {
    studentId: regNo,
    studentName: studentName.trim(),
    joinedAt: Date.now()
  };
  targetCounter.queue.push(newEntry);

  const position = targetCounter.queue.length;
  const estWaitSeconds = calculateEstimatedWait(position, targetCounter.avgServeSeconds);

  persistCountersToDb();

  broadcastSSE('queue_updated', {
    action: 'joined',
    studentId: regNo,
    studentName: newEntry.studentName,
    newCounterId: counterId,
    newCounterName: targetCounter.name,
    previousCounterId,
    previousCounterName,
    position
  });

  res.json({
    success: true,
    message: previousCounterName
      ? `Switched queue from "${previousCounterName}" to "${targetCounter.name}"!`
      : `Successfully joined "${targetCounter.name}"!`,
    counterId,
    counterName: targetCounter.name,
    position,
    estWaitSeconds,
    switchedFrom: previousCounterName
  });
});

// POST /api/counters/:id/leave - Student leaves the line
app.post('/api/counters/:id/leave', async (req, res) => {
  const counterId = req.params.id;
  const { studentId } = req.body;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'studentId is required.' });
  }

  const regNo = String(studentId).trim();
  const counter = counters.find(c => c.id === counterId);
  if (!counter) {
    return res.status(404).json({ success: false, message: 'Counter not found.' });
  }

  const index = counter.queue.findIndex(s => s.studentId === regNo);
  if (index === -1) {
    return res.status(400).json({ success: false, message: 'Student was not in this queue.' });
  }

  const [removedStudent] = counter.queue.splice(index, 1);
  persistCountersToDb();

  broadcastSSE('queue_updated', {
    action: 'left',
    studentId: regNo,
    studentName: removedStudent.studentName,
    counterId,
    counterName: counter.name
  });

  res.json({ success: true, message: `You have left ${counter.name}.` });
});

// POST /api/counters/:id/serve-next - Staff serves students one by one (dequeue)
app.post('/api/counters/:id/serve-next', async (req, res) => {
  const counterId = req.params.id;
  const counter = counters.find(c => c.id === counterId && c.status === 'active');

  if (!counter) {
    return res.status(404).json({ success: false, message: 'Counter not found or inactive.' });
  }

  if (!counter.queue || counter.queue.length === 0) {
    return res.status(400).json({ success: false, message: 'Queue is empty! No students waiting to be served.' });
  }

  // Pop student from front of queue (dequeue)
  const servedStudent = counter.queue.shift();
  const now = Date.now();

  // DYNAMIC TIME CALCULATION using JavaScript time module
  let durationSeconds;
  if (counter.lastServeTime) {
    const rawDiff = (now - counter.lastServeTime) / 1000;
    durationSeconds = Math.max(15, Math.min(180, Math.round(rawDiff)));
  } else {
    const timeSinceJoin = (now - servedStudent.joinedAt) / 1000;
    durationSeconds = Math.max(20, Math.min(120, Math.round(timeSinceJoin)));
  }

  counter.lastServeTime = now;

  const record = {
    studentId: servedStudent.studentId,
    studentName: servedStudent.studentName,
    joinedAt: servedStudent.joinedAt,
    servedAt: now,
    durationSeconds
  };

  if (!counter.servedHistory) counter.servedHistory = [];
  counter.servedHistory.push(record);

  if (!counter.recentServeDurations) counter.recentServeDurations = [];
  counter.recentServeDurations.push(durationSeconds);
  if (counter.recentServeDurations.length > 8) {
    counter.recentServeDurations.shift();
  }

  const total = counter.recentServeDurations.reduce((acc, curr) => acc + curr, 0);
  counter.avgServeSeconds = Math.max(20, Math.round(total / counter.recentServeDurations.length));

  persistCountersToDb();

  broadcastSSE('student_served', {
    counterId,
    counterName: counter.name,
    servedStudent,
    durationSeconds,
    avgServeSeconds: counter.avgServeSeconds,
    remainingInQueue: counter.queue.length
  });

  res.json({
    success: true,
    message: `Served ${servedStudent.studentName}!`,
    servedStudent,
    durationSeconds,
    avgServeSeconds: counter.avgServeSeconds,
    remainingInQueue: counter.queue.length
  });
});

// POST /api/counters/:id/close - Staff closes counter
app.post('/api/counters/:id/close', async (req, res) => {
  const counterId = req.params.id;
  const counter = counters.find(c => c.id === counterId);

  if (!counter) {
    return res.status(404).json({ success: false, message: 'Counter not found.' });
  }

  counter.status = 'closed';
  persistCountersToDb();

  broadcastSSE('counters_updated', { action: 'closed', counterId });
  res.json({ success: true, message: `Counter "${counter.name}" is now closed.` });
});

// GET /api/student-status - Check if a student is in any queue
app.get('/api/student-status', (req, res) => {
  const studentId = req.query.studentId;
  if (!studentId) {
    return res.status(400).json({ success: false, message: 'studentId query param required.' });
  }

  const cleanRegNo = String(studentId).trim();

  for (const c of counters) {
    if (c.status !== 'active') continue;
    const index = c.queue.findIndex(s => s.studentId === cleanRegNo);
    if (index !== -1) {
      const student = c.queue[index];
      const position = index + 1;
      const estWaitSeconds = calculateEstimatedWait(position, c.avgServeSeconds);
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - student.joinedAt) / 1000));

      return res.json({
        inQueue: true,
        counter: {
          id: c.id,
          name: c.name,
          foodType: c.foodType,
          menu: c.menu,
          staffName: c.staffName,
          avgServeSeconds: c.avgServeSeconds,
          queueLength: c.queue.length
        },
        student: {
          studentId: student.studentId,
          studentName: student.studentName,
          joinedAt: student.joinedAt,
          position,
          estWaitSeconds,
          elapsedSeconds
        }
      });
    }
  }

  // Check if recently served
  for (const c of counters) {
    const recent = (c.servedHistory || []).find(s => s.studentId === cleanRegNo && (Date.now() - s.servedAt) < 60000);
    if (recent) {
      return res.json({
        inQueue: false,
        justServed: true,
        counterName: c.name,
        servedAt: recent.servedAt
      });
    }
  }

  res.json({ inQueue: false });
});

// GET / - Serve main HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server and Database
app.listen(PORT, HOST, async () => {
  console.log(`MealSync Server running on http://${HOST}:${PORT}`);
  await initDatabase();
});