/**
 * MealSync - Streamlined, Robust Client Logic
 * Minimalist, reliable, and strictly starts elapsed wait time from 0 min 0 sec.
 */

// Application State
const state = {
  view: 'home',
  user: null, // { role: 'student'|'staff', name, id }
  counters: [],
  filter: 'all',
  queueStatus: { inQueue: false, counter: null, student: null }
};

// DOM Helpers
const $ = (id) => document.getElementById(id);

// Time Formatters: Strictly starts from 0 min 0 sec
function fmtTime(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0));
  return `${Math.floor(s / 60)} min ${s % 60} sec`;
}

function fmtWait(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s <= 5) return '0 min 0 sec (Next in line)';
  const m = Math.floor(s / 60), r = s % 60;
  return m === 0 ? `${r} sec` : r === 0 ? `${m} min` : `${m} min ${r} sec`;
}

// Toast Notifications
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// View Routing
function setView(name) {
  state.view = name;
  ['viewHome', 'viewStudentLogin', 'viewStaffLogin', 'viewStudentDashboard', 'viewStaffDashboard'].forEach(id => {
    $(id).style.display = 'none';
  });

  if (state.user) {
    $('navAuthBtns').style.display = 'none';
    $('navUserControls').style.display = 'flex';
    $('userNameDisplay').textContent = state.user.name;
    $('userRoleDisplay').textContent = state.user.role === 'student' ? `(${state.user.id})` : '(Staff)';
  } else {
    $('navAuthBtns').style.display = 'flex';
    $('navUserControls').style.display = 'none';
  }

  if (name === 'home') {
    $('viewHome').style.display = 'block';
    renderHomeStats();
  } else if (name === 'studentLogin') {
    $('viewStudentLogin').style.display = 'block';
    $('loginStudentName').focus();
  } else if (name === 'staffLogin') {
    $('viewStaffLogin').style.display = 'block';
    $('loginStaffName').focus();
  } else if (name === 'studentDashboard') {
    $('viewStudentDashboard').style.display = 'block';
    renderTicket();
    renderCountersTable();
  } else if (name === 'staffDashboard') {
    $('viewStaffDashboard').style.display = 'block';
    renderStaffCounters();
  }
}

// Session Management
function initSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('mealsync_session'));
    if (saved && saved.role) {
      state.user = saved;
      setView(saved.role === 'student' ? 'studentDashboard' : 'staffDashboard');
      return;
    }
  } catch (e) {}
  setView('home');
}

function logout() {
  state.user = null;
  localStorage.removeItem('mealsync_session');
  state.queueStatus = { inQueue: false, counter: null, student: null };
  toast('Logged out.');
  setView('home');
}

// ==================== DATA API ====================

async function fetchCounters() {
  try {
    const res = await fetch('/api/counters');
    const data = await res.json();
    if (data.success) {
      state.counters = data.counters;
      renderHomeStats();
      renderTicket();
      renderCountersTable();
      renderStaffCounters();
    }
  } catch (e) {}
}

let lastNotifiedServe = null;
async function checkStudentStatus() {
  if (!state.user || state.user.role !== 'student') return;
  try {
    const res = await fetch(`/api/student-status?studentId=${encodeURIComponent(state.user.id)}`);
    const data = await res.json();
    state.queueStatus = data;
    renderTicket();
    renderCountersTable();
  } catch (e) {}
}

// ==================== RENDERING ====================

function renderHomeStats() {
  let qTotal = 0, servedTotal = 0, paceSum = 0;
  state.counters.forEach(c => {
    qTotal += c.queueLength || 0;
    servedTotal += c.totalServed || 0;
    paceSum += c.avgServeSeconds || 40;
  });
  const count = state.counters.length;
  $('homeStatActiveCounters').textContent = count;
  $('homeStatTotalQueue').textContent = qTotal;
  $('homeStatAvgPace').textContent = (count > 0 ? Math.round(paceSum / count) : 40) + 's';
  $('homeStatMealsServed').textContent = servedTotal;
}

function renderTicket() {
  const wrap = $('activeTicketWrapper');
  if (!state.queueStatus.inQueue || !state.queueStatus.counter) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  const { counter, student } = state.queueStatus;

  $('ticketLineName').textContent = counter.name;
  $('ticketStaffName').textContent = counter.staffName || 'Staff';
  $('ticketFoodBadge').className = counter.foodType === 'non-veg' ? 'badge-nonveg' : 'badge-veg';
  $('ticketFoodBadge').textContent = counter.foodType === 'non-veg' ? 'Non-Veg' : 'Veg';

  $('ticketPosition').textContent = `#${student.position}`;
  $('ticketPositionNote').textContent = student.position === 1 ? 'You are currently being served!' : `${student.position - 1} student(s) ahead of you`;

  const estSec = Math.max(0, (student.position - 1) * (counter.avgServeSeconds || 40));
  $('ticketCountdown').textContent = fmtWait(estSec);
  $('ticketPaceNote').textContent = `Serving speed: ~${counter.avgServeSeconds || 40}s per student`;

  // Starts strictly at 0 min 0 sec
  const elapsed = Math.max(0, Math.floor((Date.now() - student.joinedAt) / 1000));
  $('ticketElapsed').textContent = fmtTime(elapsed);
  $('ticketMenuList').textContent = (counter.menu && counter.menu.length) ? counter.menu.join(', ') : 'Daily Mess Meal';
}

function renderCountersTable() {
  const tbody = $('countersTableBody');
  tbody.innerHTML = '';

  const list = state.counters.filter(c => state.filter === 'all' || c.foodType === state.filter);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:1.5rem;">No mess counters available.</td></tr>';
    return;
  }

  const userCounterId = state.queueStatus.inQueue && state.queueStatus.counter ? state.queueStatus.counter.id : null;

  list.forEach(c => {
    const isCurrent = userCounterId === c.id;
    const isVeg = c.foodType === 'veg';
    const badge = `<span class="${isVeg ? 'badge-veg' : 'badge-nonveg'}">${isVeg ? 'Veg' : 'Non-Veg'}</span>`;
    const wait = c.nextWaitEstimateSeconds || (c.queueLength * c.avgServeSeconds);

    let action = '';
    if (isCurrent) {
      action = `<span class="btn-action-current">In Queue (Pos #${state.queueStatus.student.position})</span>`;
    } else if (state.queueStatus.inQueue) {
      action = `<button class="btn-action-switch" onclick="joinLine('${c.id}')">Switch to this Queue</button>`;
    } else {
      action = `<button class="btn-action-join" onclick="joinLine('${c.id}')">Join Queue</button>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${c.name}</strong><br><small style="color:#64748b;">${c.staffName || 'Staff'}</small></td>
      <td>${badge}</td>
      <td style="max-width:300px;font-size:0.82rem;">${(c.menu || []).join(', ') || 'Standard Meal'}</td>
      <td><strong>${c.queueLength}</strong> in line</td>
      <td>${fmtWait(wait)}</td>
      <td>${action}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderStaffCounters() {
  const cont = $('staffCountersContainer');
  cont.innerHTML = '';

  if (!state.counters.length) {
    cont.innerHTML = '<div class="panel" style="text-align:center;padding:2rem;"><p style="color:#64748b;">No active mess counters.</p><button class="btn-nav-student" onclick="openCreateModal()">Create First Line</button></div>';
    return;
  }

  state.counters.forEach(c => {
    const isVeg = c.foodType === 'veg';
    const badge = `<span class="${isVeg ? 'badge-veg' : 'badge-nonveg'}">${isVeg ? 'Veg' : 'Non-Veg'}</span>`;
    const q = c.queue || [];
    const next = q[0];

    const serveBox = next ? `
      <div>
        <span style="font-size:0.75rem;text-transform:uppercase;color:#64748b;font-weight:600;">Next In Queue (#1)</span>
        <div style="font-size:1.15rem;font-weight:700;color:#0f172a;">${next.studentName}</div>
        <div style="font-size:0.8rem;color:#475569;">Reg: <strong>${next.studentId}</strong> &bull; Time in line: <span class="live-wait-timer" data-joined="${next.joinedAt}">${fmtTime((Date.now() - next.joinedAt)/1000)}</span></div>
      </div>
      <button class="btn-dequeue-serve" onclick="serveNext('${c.id}')">Serve Next Student (Dequeue)</button>
    ` : `
      <div><div style="font-size:1rem;font-weight:600;color:#64748b;">Queue is Empty</div><div style="font-size:0.8rem;color:#94a3b8;">Waiting for students to join</div></div>
      <button class="btn-dequeue-serve" disabled>Queue Empty</button>
    `;

    const rows = q.length ? q.map((s, idx) => `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td>${s.studentName}</td>
        <td><code>${s.studentId}</code></td>
        <td><span class="live-wait-timer" data-joined="${s.joinedAt}">${fmtTime((Date.now() - s.joinedAt)/1000)}</span></td>
        <td>${fmtWait(idx * c.avgServeSeconds)}</td>
      </tr>
    `).join('') : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1rem;">No students in queue.</td></tr>';

    const div = document.createElement('div');
    div.className = 'staff-counter-block';
    div.innerHTML = `
      <div class="staff-counter-header">
        <div>
          <span style="font-size:1.15rem;font-weight:700;margin-right:0.5rem;">${c.name}</span>${badge}
          <div style="font-size:0.8rem;color:#475569;margin-top:0.2rem;">Staff: <strong>${c.staffName || 'Staff'}</strong> &bull; Menu: ${(c.menu || []).join(', ')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span style="font-size:0.82rem;color:#475569;">Avg: ~${c.avgServeSeconds}s/student</span>
          <button class="btn-close-counter" onclick="closeCounter('${c.id}')">Close</button>
        </div>
      </div>
      <div class="staff-serve-box">${serveBox}</div>
      <div style="font-size:0.82rem;font-weight:600;margin-bottom:0.4rem;">Current Queue (${q.length})</div>
      <table class="counters-table" style="font-size:0.82rem;">
        <thead><tr><th>Pos</th><th>Name</th><th>Reg No</th><th>Time in Line</th><th>Est. Ready</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    cont.appendChild(div);
  });
}

// 1-Second Interval Ticker: strictly starts at 0 min 0 sec
setInterval(() => {
  if (state.queueStatus.inQueue && state.queueStatus.student) {
    const elapsed = Math.max(0, Math.floor((Date.now() - state.queueStatus.student.joinedAt) / 1000));
    $('ticketElapsed').textContent = fmtTime(elapsed);
  }
  document.querySelectorAll('.live-wait-timer').forEach(el => {
    const j = parseInt(el.getAttribute('data-joined'), 10);
    if (!isNaN(j)) el.textContent = fmtTime((Date.now() - j) / 1000);
  });
}, 1000);

// ==================== ACTIONS ====================

window.joinLine = async function(id) {
  if (!state.user || state.user.role !== 'student') {
    toast('Please login as a student first.');
    setView('studentLogin');
    return;
  }
  try {
    const res = await fetch(`/api/counters/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: state.user.id, studentName: state.user.name })
    });
    const d = await res.json();
    if (d.success) {
      toast(d.message, 'success');
      $('ticketElapsed').textContent = '0 min 0 sec';
      await fetchCounters();
      await checkStudentStatus();
    } else {
      toast(d.message || 'Error joining line.', 'danger');
    }
  } catch (e) { toast('Network error.', 'danger'); }
};

window.leaveLine = async function(id) {
  if (!state.user || state.user.role !== 'student') return;
  try {
    const res = await fetch(`/api/counters/${id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: state.user.id })
    });
    const d = await res.json();
    if (d.success) {
      toast(d.message);
      state.queueStatus = { inQueue: false, counter: null, student: null };
      renderTicket();
      await fetchCounters();
    }
  } catch (e) {}
};

window.serveNext = async function(id) {
  try {
    const res = await fetch(`/api/counters/${id}/serve-next`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      toast(`Served ${d.servedStudent.studentName} (${d.durationSeconds}s). Speed: ~${d.avgServeSeconds}s.`, 'success');
      await fetchCounters();
      await checkStudentStatus();
    } else {
      toast(d.message || 'Error serving.', 'warning');
    }
  } catch (e) {}
};

window.closeCounter = async function(id) {
  if (!confirm('Close this counter?')) return;
  try {
    const res = await fetch(`/api/counters/${id}/close`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      toast(d.message);
      await fetchCounters();
    }
  } catch (e) {}
};

// Modals
window.openCreateModal = () => $('createCounterModal').classList.add('open');
window.closeCreateModal = () => $('createCounterModal').classList.remove('open');

$('createCounterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('inputLineName').value.trim();
  const foodType = document.querySelector('input[name="foodType"]:checked').value;
  const staffName = $('inputStaffName').value.trim();
  const menu = $('inputMenu').value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/counters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, foodType, staffName, menu })
    });
    const d = await res.json();
    if (d.success) {
      toast('Mess line created.', 'success');
      $('createCounterForm').reset();
      closeCreateModal();
      await fetchCounters();
    }
  } catch (e) { toast('Error creating line.', 'danger'); }
});

// Auth Handlers
$('loginStudentId').addEventListener('input', (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 10);
  e.target.value = v;
  $('regNoCounter').textContent = `${v.length} / 10 digits entered`;
  if (v.length === 10) $('regNoFeedback').style.display = 'none';
});

$('studentLoginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('loginStudentName').value.trim();
  const regNo = $('loginStudentId').value.trim();
  if (!name) return;
  if (!/^\d{10}$/.test(regNo)) {
    $('regNoFeedback').style.display = 'block';
    $('loginStudentId').focus();
    return;
  }
  state.user = { role: 'student', name, id: regNo };
  localStorage.setItem('mealsync_session', JSON.stringify(state.user));
  toast(`Logged in as ${name}`, 'success');
  setView('studentDashboard');
  fetchCounters();
  checkStudentStatus();
});

$('staffLoginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('loginStaffName').value.trim();
  if (!name) return;
  state.user = { role: 'staff', name, id: 'staff' };
  localStorage.setItem('mealsync_session', JSON.stringify(state.user));
  toast(`Staff portal: ${name}`, 'success');
  setView('staffDashboard');
  fetchCounters();
});

window.fillStudentDemo = (name, regNo) => {
  $('loginStudentName').value = name;
  $('loginStudentId').value = regNo;
  $('regNoCounter').textContent = '10 / 10 digits entered';
  $('regNoFeedback').style.display = 'none';
};

window.fillStaffDemo = (name) => { $('loginStaffName').value = name; };

// Setup Event Listeners
$('navBrand').addEventListener('click', () => setView('home'));
$('btnNavStudentLogin').addEventListener('click', () => setView('studentLogin'));
$('btnNavStaffLogin').addEventListener('click', () => setView('staffLogin'));
$('heroBtnStudent').addEventListener('click', () => setView('studentLogin'));
$('heroBtnStaff').addEventListener('click', () => setView('staffLogin'));
$('btnLogout').addEventListener('click', logout);
$('btnBackFromStudentLogin').addEventListener('click', () => setView('home'));
$('btnBackFromStaffLogin').addEventListener('click', () => setView('home'));
$('btnOpenCreateCounterModal').addEventListener('click', openCreateModal);
$('btnCloseCreateModal').addEventListener('click', closeCreateModal);
$('btnCancelCreateModal').addEventListener('click', closeCreateModal);

$('btnLeaveActiveQueue').addEventListener('click', () => {
  if (state.queueStatus.counter) leaveLine(state.queueStatus.counter.id);
});

$('filterAllBtn').addEventListener('click', () => { state.filter = 'all'; renderCountersTable(); });
$('filterVegBtn').addEventListener('click', () => { state.filter = 'veg'; renderCountersTable(); });
$('filterNonVegBtn').addEventListener('click', () => { state.filter = 'non-veg'; renderCountersTable(); });

// Real-time EventSource
function setupSSE() {
  try {
    const es = new EventSource('/api/stream');
    es.addEventListener('queue_updated', () => { fetchCounters(); checkStudentStatus(); });
    es.addEventListener('counters_updated', () => { fetchCounters(); checkStudentStatus(); });
    es.addEventListener('student_served', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (state.user && state.user.role === 'student' && payload.servedStudent && payload.servedStudent.studentId === state.user.id) {
          toast(`Your meal is ready at ${payload.counterName}!`, 'success');
        }
      } catch (err) {}
      fetchCounters();
      checkStudentStatus();
    });
  } catch (e) {}
}

window.addEventListener('DOMContentLoaded', async () => {
  initSession();
  await fetchCounters();
  await checkStudentStatus();
  setupSSE();
  setInterval(() => { fetchCounters(); checkStudentStatus(); }, 5000);
});
