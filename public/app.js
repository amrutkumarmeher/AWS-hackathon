/**
 * MealSync - Client Side Logic
 * Real-time mess queue management with dynamic JS time wait estimation,
 * Landing page first, separate student/staff login, and 10-digit reg no validation.
 */

// Application State
const state = {
  currentView: 'home', // 'home' | 'studentLogin' | 'staffLogin' | 'studentDashboard' | 'staffDashboard'
  currentUser: null,   // null | { role: 'student', studentName, studentId } | { role: 'staff', staffName }
  counters: [],
  activeFilter: 'all',
  studentStatus: {
    inQueue: false,
    counter: null,
    student: null
  }
};

// Web Audio API Chimes
function playTone(freq = 587.33, type = 'sine', duration = 0.22) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function playSuccessChime() {
  playTone(523.25, 'triangle', 0.15); // C5
  setTimeout(() => playTone(659.25, 'triangle', 0.15), 120); // E5
  setTimeout(() => playTone(783.99, 'triangle', 0.3), 240); // G5
}

function playServeChime() {
  playTone(659.25, 'sine', 0.15);
  setTimeout(() => playTone(880.00, 'sine', 0.35), 150);
}

// Time Formatters
function formatTimeMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatEstimatedWait(seconds) {
  if (seconds <= 5) return 'Ready Now! 🍽️';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `~${secs}s`;
  if (secs === 0) return `~${mins} min`;
  return `~${mins}m ${secs}s`;
}

// ==================== DOM ELEMENTS ====================
// Views
const viewHome = document.getElementById('viewHome');
const viewStudentLogin = document.getElementById('viewStudentLogin');
const viewStaffLogin = document.getElementById('viewStaffLogin');
const viewStudentDashboard = document.getElementById('viewStudentDashboard');
const viewStaffDashboard = document.getElementById('viewStaffDashboard');

// Header
const navBrand = document.getElementById('navBrand');
const navAuthBtns = document.getElementById('navAuthBtns');
const btnNavStudentLogin = document.getElementById('btnNavStudentLogin');
const btnNavStaffLogin = document.getElementById('btnNavStaffLogin');
const navUserControls = document.getElementById('navUserControls');
const userNameDisplay = document.getElementById('userNameDisplay');
const userRoleDisplay = document.getElementById('userRoleDisplay');
const userAvatarText = document.getElementById('userAvatarText');
const btnLogout = document.getElementById('btnLogout');

// Home
const heroBtnStudent = document.getElementById('heroBtnStudent');
const heroBtnStaff = document.getElementById('heroBtnStaff');
const homeStatActiveCounters = document.getElementById('homeStatActiveCounters');
const homeStatTotalQueue = document.getElementById('homeStatTotalQueue');
const homeStatAvgPace = document.getElementById('homeStatAvgPace');
const homeStatMealsServed = document.getElementById('homeStatMealsServed');

// Student Login Form
const btnBackFromStudentLogin = document.getElementById('btnBackFromStudentLogin');
const studentLoginForm = document.getElementById('studentLoginForm');
const loginStudentName = document.getElementById('loginStudentName');
const loginStudentId = document.getElementById('loginStudentId');
const regNoCounter = document.getElementById('regNoCounter');
const regNoFeedback = document.getElementById('regNoFeedback');

// Staff Login Form
const btnBackFromStaffLogin = document.getElementById('btnBackFromStaffLogin');
const staffLoginForm = document.getElementById('staffLoginForm');
const loginStaffName = document.getElementById('loginStaffName');

// Student Dashboard Elements
const activeTicketWrapper = document.getElementById('activeTicketWrapper');
const ticketLineName = document.getElementById('ticketLineName');
const ticketFoodBadge = document.getElementById('ticketFoodBadge');
const ticketStaffName = document.getElementById('ticketStaffName');
const ticketPosition = document.getElementById('ticketPosition');
const ticketPositionNote = document.getElementById('ticketPositionNote');
const ticketCountdown = document.getElementById('ticketCountdown');
const ticketPaceNote = document.getElementById('ticketPaceNote');
const ticketElapsed = document.getElementById('ticketElapsed');
const ticketMenuList = document.getElementById('ticketMenuList');
const btnLeaveActiveQueue = document.getElementById('btnLeaveActiveQueue');
const countersGrid = document.getElementById('countersGrid');

// Filter Buttons
const filterAllBtn = document.getElementById('filterAllBtn');
const filterVegBtn = document.getElementById('filterVegBtn');
const filterNonVegBtn = document.getElementById('filterNonVegBtn');

// Staff Dashboard Elements
const btnOpenCreateCounterModal = document.getElementById('btnOpenCreateCounterModal');
const staffCountersContainer = document.getElementById('staffCountersContainer');

// Create Modal
const createCounterModal = document.getElementById('createCounterModal');
const btnCloseCreateModal = document.getElementById('btnCloseCreateModal');
const btnCancelCreateModal = document.getElementById('btnCancelCreateModal');
const createCounterForm = document.getElementById('createCounterForm');
const inputLineName = document.getElementById('inputLineName');
const inputStaffName = document.getElementById('inputStaffName');
const inputMenu = document.getElementById('inputMenu');

const toastContainer = document.getElementById('toastContainer');

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'celebrate' ? '🎉' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span><div>${message}</div>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ==================== VIEW ROUTING & NAVIGATION ====================

function switchView(viewName) {
  state.currentView = viewName;

  // Hide all views
  viewHome.style.display = 'none';
  viewStudentLogin.style.display = 'none';
  viewStaffLogin.style.display = 'none';
  viewStudentDashboard.style.display = 'none';
  viewStaffDashboard.style.display = 'none';

  // Update Header
  if (state.currentUser) {
    navAuthBtns.style.display = 'none';
    navUserControls.style.display = 'flex';

    if (state.currentUser.role === 'student') {
      userNameDisplay.textContent = state.currentUser.studentName;
      userRoleDisplay.textContent = `#${state.currentUser.studentId}`;
      const initials = state.currentUser.studentName.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();
      userAvatarText.textContent = initials || 'ST';
    } else {
      userNameDisplay.textContent = state.currentUser.staffName;
      userRoleDisplay.textContent = 'Mess Staff';
      userAvatarText.textContent = '👨‍🍳';
    }
  } else {
    navAuthBtns.style.display = 'flex';
    navUserControls.style.display = 'none';
  }

  // Show target view
  if (viewName === 'home') {
    viewHome.style.display = 'block';
    renderHomeStats();
  } else if (viewName === 'studentLogin') {
    viewStudentLogin.style.display = 'block';
    loginStudentName.focus();
  } else if (viewName === 'staffLogin') {
    viewStaffLogin.style.display = 'block';
    loginStaffName.focus();
  } else if (viewName === 'studentDashboard') {
    viewStudentDashboard.style.display = 'block';
    renderActiveTicket();
    renderCountersGrid();
  } else if (viewName === 'staffDashboard') {
    viewStaffDashboard.style.display = 'block';
    renderStaffCounters();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Restore saved session on load or show home page
function initSession() {
  const saved = localStorage.getItem('mealsync_user');
  if (saved) {
    try {
      const user = JSON.parse(saved);
      if (user && user.role) {
        state.currentUser = user;
        if (user.role === 'student') {
          switchView('studentDashboard');
        } else {
          switchView('staffDashboard');
        }
        return;
      }
    } catch (e) {}
  }
  // Default to Home page on first visit!
  switchView('home');
}

function logout() {
  state.currentUser = null;
  localStorage.removeItem('mealsync_user');
  state.studentStatus = { inQueue: false, counter: null, student: null };
  showToast('Logged out. Returned to MealSync Home.', 'info');
  switchView('home');
}

// ==================== 10-DIGIT REGISTRATION NUMBER VALIDATION ====================
// Real-time digit filtering and counter
loginStudentId.addEventListener('input', (e) => {
  // Strip non-digits
  const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
  e.target.value = digits;

  regNoCounter.textContent = `${digits.length} / 10 digits`;
  if (digits.length === 10) {
    regNoCounter.className = 'char-counter-badge valid';
    loginStudentId.classList.remove('error');
    regNoFeedback.style.display = 'none';
  } else {
    regNoCounter.className = 'char-counter-badge';
  }
});

// Student Login Form Submit
studentLoginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = loginStudentName.value.trim();
  const regNo = loginStudentId.value.trim();

  if (!name) {
    showToast('Please enter your name.', 'warning');
    loginStudentName.focus();
    return;
  }

  // Strict 10-digit check
  if (!/^\d{10}$/.test(regNo)) {
    loginStudentId.classList.add('error');
    regNoFeedback.style.display = 'block';
    showToast('Student registration number must be a 10-digit number (e.g. 2102090012).', 'warning');
    loginStudentId.focus();
    return;
  }

  state.currentUser = {
    role: 'student',
    studentName: name,
    studentId: regNo
  };
  localStorage.setItem('mealsync_user', JSON.stringify(state.currentUser));

  showToast(`Welcome, ${name}! (${regNo})`, 'success');
  switchView('studentDashboard');
  fetchCounters();
  checkStudentStatus();
});

// Staff Login Form Submit
staffLoginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = loginStaffName.value.trim();

  if (!name) {
    showToast('Please enter staff name.', 'warning');
    loginStaffName.focus();
    return;
  }

  state.currentUser = {
    role: 'staff',
    staffName: name
  };
  localStorage.setItem('mealsync_user', JSON.stringify(state.currentUser));

  showToast(`Welcome, ${name}! Staff portal active.`, 'success');
  switchView('staffDashboard');
  fetchCounters();
});

// Demo Fillers
window.fillStudentDemo = function(name, regNo) {
  loginStudentName.value = name;
  loginStudentId.value = regNo;
  regNoCounter.textContent = '10 / 10 digits';
  regNoCounter.className = 'char-counter-badge valid';
  loginStudentId.classList.remove('error');
  regNoFeedback.style.display = 'none';
};

window.fillStaffDemo = function(name) {
  loginStaffName.value = name;
};

// ==================== DATA FETCHING ====================

async function fetchCounters() {
  try {
    const res = await fetch('/api/counters');
    const data = await res.json();
    if (data.success) {
      state.counters = data.counters;
      renderHomeStats();
      renderActiveTicket();
      renderCountersGrid();
      renderStaffCounters();
    }
  } catch (err) {
    console.error('Failed to fetch counters:', err);
  }
}

async function checkStudentStatus() {
  if (!state.currentUser || state.currentUser.role !== 'student') return;
  const regNo = state.currentUser.studentId;

  try {
    const res = await fetch(`/api/student-status?studentId=${encodeURIComponent(regNo)}`);
    const data = await res.json();

    if (data.justServed) {
      showToast(`🎉 You were served at "${data.counterName}"! Enjoy your meal.`, 'celebrate', 8000);
      playServeChime();
    }

    state.studentStatus = data;
    renderActiveTicket();
    renderCountersGrid();
  } catch (err) {
    console.error('Failed to check student status:', err);
  }
}

// ==================== RENDERING LOGIC ====================

// Render Home Page Live Metrics
function renderHomeStats() {
  const activeCount = state.counters.length;
  let totalQueue = 0;
  let totalServed = 0;
  let paceSum = 0;

  for (const c of state.counters) {
    totalQueue += c.queueLength || 0;
    totalServed += c.totalServed || 0;
    paceSum += c.avgServeSeconds || 40;
  }

  const avgPace = activeCount > 0 ? Math.round(paceSum / activeCount) : 40;

  homeStatActiveCounters.textContent = activeCount;
  homeStatTotalQueue.textContent = totalQueue;
  homeStatAvgPace.textContent = `${avgPace}s`;
  homeStatMealsServed.textContent = totalServed;
}

// Render Student Active Queue Ticket
function renderActiveTicket() {
  if (!state.studentStatus.inQueue || !state.studentStatus.counter) {
    activeTicketWrapper.style.display = 'none';
    return;
  }

  const { counter, student } = state.studentStatus;
  activeTicketWrapper.style.display = 'block';

  ticketLineName.textContent = counter.name;
  ticketStaffName.textContent = counter.staffName || 'Mess Staff';

  if (counter.foodType === 'non-veg') {
    ticketFoodBadge.className = 'food-badge non-veg';
    ticketFoodBadge.innerHTML = '🍗 Non-Veg';
  } else {
    ticketFoodBadge.className = 'food-badge veg';
    ticketFoodBadge.innerHTML = '🌿 Pure Veg';
  }

  // Position
  if (student.position === 1) {
    ticketPosition.className = 'ticket-position-number being-served';
    ticketPosition.textContent = 'YOU ARE NEXT!';
    ticketPositionNote.textContent = 'Please proceed to the serving tray pickup!';
  } else {
    ticketPosition.className = 'ticket-position-number';
    ticketPosition.textContent = `#${student.position}`;
    ticketPositionNote.textContent = `${student.position - 1} student(s) ahead of you`;
  }

  // Wait time calculation
  const estSeconds = Math.max(0, (student.position - 1) * (counter.avgServeSeconds || 40));
  ticketCountdown.textContent = formatEstimatedWait(estSeconds);
  ticketPaceNote.textContent = `⚡ Avg Pace: ~${counter.avgServeSeconds || 40}s per student`;

  // Render Full Menu for this Queue
  ticketMenuList.innerHTML = '';
  if (counter.menu && counter.menu.length > 0) {
    for (const item of counter.menu) {
      const tag = document.createElement('span');
      tag.className = 'dish-tag';
      tag.textContent = item;
      ticketMenuList.appendChild(tag);
    }
  } else {
    ticketMenuList.innerHTML = '<span class="dish-tag">Daily Mess Meal</span>';
  }
}

// Render Counters Grid (Student View)
function renderCountersGrid() {
  countersGrid.innerHTML = '';

  const filtered = state.counters.filter(c => {
    if (state.activeFilter === 'veg') return c.foodType === 'veg';
    if (state.activeFilter === 'non-veg') return c.foodType === 'non-veg';
    return true;
  });

  if (filtered.length === 0) {
    countersGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-glass);">
        <p style="font-size: 1.1rem; color: var(--text-secondary);">No active mess counters found for this filter.</p>
      </div>
    `;
    return;
  }

  const isUserQueued = state.studentStatus.inQueue;
  const userCounterId = isUserQueued && state.studentStatus.counter ? state.studentStatus.counter.id : null;

  for (const counter of filtered) {
    const isCurrentCounter = userCounterId === counter.id;
    const card = document.createElement('div');
    card.className = `counter-card ${isCurrentCounter ? 'in-queue' : ''}`;

    const isVeg = counter.foodType === 'veg';
    const estWait = counter.nextWaitEstimateSeconds || (counter.queueLength * counter.avgServeSeconds);
    const speedPillClass = estWait < 120 ? 'fast' : estWait < 300 ? 'medium' : 'slow';

    const menuPills = (counter.menu || []).slice(0, 4).map(m => `<span class="menu-pill">${m}</span>`).join('');
    const extraCount = (counter.menu || []).length > 4 ? `<span class="menu-pill">+${counter.menu.length - 4} more</span>` : '';

    let actionBtnHtml = '';
    if (isCurrentCounter) {
      actionBtnHtml = `
        <button class="btn-join-line current" disabled>
          <span>✓</span> You Are In This Queue (Pos #${state.studentStatus.student.position})
        </button>
      `;
    } else if (isUserQueued) {
      actionBtnHtml = `
        <button class="btn-join-line switch" onclick="joinLine('${counter.id}')">
          <span>🔄</span> Switch To This Line
        </button>
      `;
    } else {
      actionBtnHtml = `
        <button class="btn-join-line" onclick="joinLine('${counter.id}')">
          <span>🚶‍♂️</span> Join Line
        </button>
      `;
    }

    card.innerHTML = `
      <div>
        <div class="counter-card-header">
          <div class="counter-title-group">
            <h3>${counter.name}</h3>
            <div class="counter-staff">In charge: ${counter.staffName || 'Staff'}</div>
          </div>
          <span class="food-badge ${isVeg ? 'veg' : 'non-veg'}">
            ${isVeg ? '🌿 Veg' : '🍗 Non-Veg'}
          </span>
        </div>

        <div class="counter-stats-bar">
          <div class="mini-stat">
            <span class="mini-stat-label">In Line</span>
            <span class="mini-stat-val">👥 ${counter.queueLength} waiting</span>
          </div>
          <div class="mini-stat">
            <span class="mini-stat-label">Est. Wait</span>
            <span class="mini-stat-val ${speedPillClass}">⏱️ ${formatEstimatedWait(estWait)}</span>
          </div>
        </div>

        <div class="counter-menu-box">
          <div class="counter-menu-label">Menu Items Served:</div>
          <div class="counter-menu-pills">
            ${menuPills || '<span class="menu-pill">Daily Mess Meal</span>'}
            ${extraCount}
          </div>
        </div>
      </div>

      <div style="margin-top: 1rem;">
        <div style="display: flex; justify-content: space-between; font-size: 0.76rem; color: var(--text-muted); margin-bottom: 0.75rem;">
          <span>Avg Speed: ~${counter.avgServeSeconds}s/student</span>
          <span>${counter.totalServed} served</span>
        </div>
        ${actionBtnHtml}
      </div>
    `;

    countersGrid.appendChild(card);
  }
}

// Render Staff Dashboard (Dequeue & Counter Management)
function renderStaffCounters() {
  staffCountersContainer.innerHTML = '';

  if (state.counters.length === 0) {
    staffCountersContainer.innerHTML = `
      <div style="text-align: center; padding: 3rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-glass);">
        <p style="font-size: 1.15rem; color: var(--text-secondary); margin-bottom: 1rem;">No mess counters currently open.</p>
        <button class="btn-create-counter" onclick="openCreateModal()">
          <span>➕</span> Create First Mess Line
        </button>
      </div>
    `;
    return;
  }

  for (const counter of state.counters) {
    const card = document.createElement('div');
    card.className = 'staff-counter-card';

    const isVeg = counter.foodType === 'veg';
    const queue = counter.queue || [];
    const nextStudent = queue.length > 0 ? queue[0] : null;

    let nextStudentHtml = '';
    if (nextStudent) {
      const waitSec = Math.max(0, Math.floor((Date.now() - nextStudent.joinedAt) / 1000));
      nextStudentHtml = `
        <div class="next-student-info">
          <h4>Next In Line (Position #1)</h4>
          <div class="next-student-name">${nextStudent.studentName}</div>
          <div class="next-student-sub">Reg No: #${nextStudent.studentId} • Waiting for: <span class="live-student-wait" data-joined="${nextStudent.joinedAt}">${formatTimeMMSS(waitSec)}</span></div>
        </div>
        <button class="btn-serve-next" onclick="serveNext('${counter.id}')">
          <span>🍽️</span> Serve Next Student (Dequeue)
        </button>
      `;
    } else {
      nextStudentHtml = `
        <div class="next-student-info">
          <h4>Queue Status</h4>
          <div class="next-student-name" style="color: var(--text-muted); font-size: 1.1rem;">No students waiting in queue</div>
          <div class="next-student-sub">Counter ready for incoming students</div>
        </div>
        <button class="btn-serve-next" disabled>
          <span>🍽️</span> Queue Empty
        </button>
      `;
    }

    // Queue table rows with 10-digit reg numbers
    let tableRows = '';
    if (queue.length > 0) {
      tableRows = queue.map((s, idx) => {
        const estSec = Math.max(0, idx * counter.avgServeSeconds);
        return `
          <tr>
            <td><strong>#${idx + 1}</strong></td>
            <td>${s.studentName}</td>
            <td><code style="color: var(--primary-light);">${s.studentId}</code></td>
            <td><span class="live-student-wait" data-joined="${s.joinedAt}">${formatTimeMMSS((Date.now() - s.joinedAt)/1000)}</span></td>
            <td>${formatEstimatedWait(estSec)}</td>
          </tr>
        `;
      }).join('');
    } else {
      tableRows = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No students in line right now.</td></tr>`;
    }

    card.innerHTML = `
      <div class="staff-counter-top">
        <div>
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.35rem;">
            <h3 style="font-family: var(--font-heading); font-size: 1.35rem;">${counter.name}</h3>
            <span class="food-badge ${isVeg ? 'veg' : 'non-veg'}">
              ${isVeg ? '🌿 Veg' : '🍗 Non-Veg'}
            </span>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-secondary);">
            Staff: <strong>${counter.staffName || 'Staff'}</strong> • 
            Menu: <em>${(counter.menu || []).join(', ')}</em>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="text-align: right;">
            <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Average Speed</div>
            <strong style="color: var(--primary-light); font-size: 1.1rem;">⚡ ~${counter.avgServeSeconds}s / student</strong>
          </div>
          <button class="btn-secondary" style="padding: 0.5rem 0.9rem; font-size: 0.8rem; color: #ef4444;" onclick="closeCounter('${counter.id}')">
            Close Line
          </button>
        </div>
      </div>

      <!-- Serve Next Action Box -->
      <div class="staff-serve-box">
        ${nextStudentHtml}
      </div>

      <!-- Queue Table -->
      <div>
        <h4 style="font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.75rem;">
          Waiting Students (${queue.length})
        </h4>
        <div class="staff-queue-table-wrap">
          <table class="queue-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Student Name</th>
                <th>Registration No.</th>
                <th>Elapsed Wait</th>
                <th>Est. Ready</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    staffCountersContainer.appendChild(card);
  }
}

// ==================== REAL-TIME JS TIME TICKER ====================
// Runs every second to dynamically update elapsed timers and ETA countdowns
setInterval(() => {
  if (state.studentStatus.inQueue && state.studentStatus.student) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - state.studentStatus.student.joinedAt) / 1000));
    ticketElapsed.textContent = formatTimeMMSS(elapsedSeconds);
  }

  const waitSpans = document.querySelectorAll('.live-student-wait');
  for (const span of waitSpans) {
    const joinedAt = parseInt(span.getAttribute('data-joined'), 10);
    if (!isNaN(joinedAt)) {
      const s = Math.max(0, Math.floor((Date.now() - joinedAt) / 1000));
      span.textContent = formatTimeMMSS(s);
    }
  }
}, 1000);

// ==================== USER ACTIONS: JOIN & LEAVE ====================

window.joinLine = async function(counterId) {
  if (!state.currentUser || state.currentUser.role !== 'student') {
    showToast('Please log in as a student to join a queue.', 'warning');
    switchView('studentLogin');
    return;
  }

  try {
    const res = await fetch(`/api/counters/${counterId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: state.currentUser.studentId,
        studentName: state.currentUser.studentName
      })
    });

    const data = await res.json();
    if (data.success) {
      playSuccessChime();
      showToast(data.message, 'success');
      await fetchCounters();
      await checkStudentStatus();
    } else {
      showToast(data.message || 'Failed to join line.', 'warning');
    }
  } catch (err) {
    console.error('Error joining line:', err);
    showToast('Network error while joining line.', 'warning');
  }
};

window.leaveLine = async function(counterId) {
  if (!state.currentUser || state.currentUser.role !== 'student') return;

  try {
    const res = await fetch(`/api/counters/${counterId}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: state.currentUser.studentId
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'info');
      state.studentStatus = { inQueue: false, counter: null, student: null };
      renderActiveTicket();
      await fetchCounters();
    } else {
      showToast(data.message || 'Failed to leave line.', 'warning');
    }
  } catch (err) {
    console.error('Error leaving line:', err);
  }
};

// Staff Action: Dequeue and Serve Next
window.serveNext = async function(counterId) {
  try {
    const res = await fetch(`/api/counters/${counterId}/serve-next`, {
      method: 'POST'
    });

    const data = await res.json();
    if (data.success) {
      playSuccessChime();
      showToast(`🍽️ Dequeued & served ${data.servedStudent.studentName} in ${data.durationSeconds}s! Avg speed updated to ~${data.avgServeSeconds}s.`, 'success');
      await fetchCounters();
      await checkStudentStatus();
    } else {
      showToast(data.message || 'Failed to serve.', 'warning');
    }
  } catch (err) {
    console.error('Error serving student:', err);
  }
};

window.closeCounter = async function(counterId) {
  if (!confirm('Are you sure you want to close this mess counter?')) return;
  try {
    const res = await fetch(`/api/counters/${counterId}/close`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'info');
      await fetchCounters();
      await checkStudentStatus();
    }
  } catch (err) {
    console.error('Error closing counter:', err);
  }
};

// ==================== MODALS & FORM HANDLERS ====================

function openCreateModal() {
  createCounterModal.classList.add('open');
}

function closeCreateModal() {
  createCounterModal.classList.remove('open');
}

window.openCreateModal = openCreateModal;

window.setLineNamePreset = function(name) {
  inputLineName.value = name;
};

window.appendDishPreset = function(dish) {
  const current = inputMenu.value.trim();
  if (!current) {
    inputMenu.value = dish;
  } else {
    inputMenu.value = `${current}, ${dish}`;
  }
};

createCounterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = inputLineName.value.trim();
  const foodType = createCounterForm.querySelector('input[name="foodType"]:checked').value;
  const staffName = inputStaffName.value.trim();
  const menu = inputMenu.value.trim();

  if (!name) return;

  try {
    const res = await fetch('/api/counters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, foodType, staffName, menu })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Serving line "${name}" launched successfully!`, 'success');
      createCounterForm.reset();
      closeCreateModal();
      await fetchCounters();
    } else {
      showToast(data.message || 'Failed to create line', 'warning');
    }
  } catch (err) {
    console.error('Error creating line:', err);
    showToast('Network error while creating line.', 'warning');
  }
});

// ==================== GLOBAL EVENT LISTENERS ====================

navBrand.addEventListener('click', () => switchView('home'));
btnNavStudentLogin.addEventListener('click', () => switchView('studentLogin'));
btnNavStaffLogin.addEventListener('click', () => switchView('staffLogin'));
heroBtnStudent.addEventListener('click', () => switchView('studentLogin'));
heroBtnStaff.addEventListener('click', () => switchView('staffLogin'));
btnLogout.addEventListener('click', logout);

btnBackFromStudentLogin.addEventListener('click', () => switchView('home'));
btnBackFromStaffLogin.addEventListener('click', () => switchView('home'));

btnLeaveActiveQueue.addEventListener('click', () => {
  if (state.studentStatus.counter) {
    leaveLine(state.studentStatus.counter.id);
  }
});

btnOpenCreateCounterModal.addEventListener('click', openCreateModal);
btnCloseCreateModal.addEventListener('click', closeCreateModal);
btnCancelCreateModal.addEventListener('click', closeCreateModal);

// Filter buttons
filterAllBtn.addEventListener('click', () => {
  state.activeFilter = 'all';
  filterAllBtn.classList.add('active');
  filterVegBtn.classList.remove('active');
  filterNonVegBtn.classList.remove('active');
  renderCountersGrid();
});

filterVegBtn.addEventListener('click', () => {
  state.activeFilter = 'veg';
  filterVegBtn.classList.add('active');
  filterAllBtn.classList.remove('active');
  filterNonVegBtn.classList.remove('active');
  renderCountersGrid();
});

filterNonVegBtn.addEventListener('click', () => {
  state.activeFilter = 'non-veg';
  filterNonVegBtn.classList.add('active');
  filterAllBtn.classList.remove('active');
  filterVegBtn.classList.remove('active');
  renderCountersGrid();
});

// ==================== SERVER-SENT EVENTS (SSE) ====================
function setupRealtimeStream() {
  try {
    const eventSource = new EventSource('/api/stream');

    eventSource.addEventListener('connected', () => {
      document.getElementById('liveStatusText').textContent = 'Live Mess Synced';
    });

    eventSource.addEventListener('counters_updated', () => {
      fetchCounters();
      checkStudentStatus();
    });

    eventSource.addEventListener('queue_updated', () => {
      fetchCounters();
      checkStudentStatus();
    });

    eventSource.addEventListener('student_served', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (state.currentUser && state.currentUser.role === 'student' && payload.servedStudent) {
          if (payload.servedStudent.studentId === state.currentUser.studentId) {
            showToast(`🎉 You were served at "${payload.counterName}"! Please pick up your food tray!`, 'celebrate', 9000);
            playServeChime();
          }
        }
      } catch (err) {}
      fetchCounters();
      checkStudentStatus();
    });

    eventSource.onerror = () => {
      document.getElementById('liveStatusText').textContent = 'Reconnecting...';
    };
  } catch (err) {
    console.warn('SSE fallback to polling');
  }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', async () => {
  initSession();
  await fetchCounters();
  await checkStudentStatus();
  setupRealtimeStream();

  // Background polling every 4 seconds as safety backup
  setInterval(async () => {
    await fetchCounters();
    await checkStudentStatus();
  }, 4000);
});
