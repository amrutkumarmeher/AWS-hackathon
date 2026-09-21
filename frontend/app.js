

function getApiUrl(endpoint) {
  if (window.MEALSYNC_CONFIG && typeof window.MEALSYNC_CONFIG.apiUrl === 'function') {
    return window.MEALSYNC_CONFIG.apiUrl(endpoint);
  }
  return endpoint;
}

const _originalFetch = window.fetch.bind(window);
window.fetch = function (resource, options) {
  const opts = Object.assign({ credentials: 'omit', mode: 'cors' }, options || {});
  if (typeof resource === 'string' && (resource.startsWith('/api') || resource === '/api')) {
    resource = getApiUrl(resource);
  } else if (resource && typeof resource === 'object' && typeof resource.url === 'string' && resource.url.startsWith('/api')) {
    resource = new Request(getApiUrl(resource.url.replace(window.location.origin, '')), resource);
  }
  return _originalFetch(resource, opts);
};

function updateLiveStatus(connected, customMsg) {
  const statusText = $('liveStatusText');
  const dot = document.querySelector('.live-dot');
  if (!statusText) return;
  if (connected) {
    statusText.textContent = customMsg || 'System Connected';
    if (dot) {
      dot.style.backgroundColor = '#10b981';
      dot.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.6)';
    }
  } else {
    statusText.textContent = customMsg || 'Connecting to Backend...';
    if (dot) {
      dot.style.backgroundColor = '#f59e0b';
      dot.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.6)';
    }
  }
}

const state = {
  view: 'home',
  user: null,
  counters: [],
  filter: 'all',
  queueStatus: { inQueue: false, counter: null, student: null },
  notificationsEnabled: false,
  lastNotifiedPosition: 999,
  adminTab: 'moderation',
  adminOverview: null,
  schedules: [],
  activeSlot: null,
  upcomingSlot: null,
  announcement: ''
};

const $ = (id) => document.getElementById(id);

function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(830.61, now + 0.12);
    gain2.gain.setValueAtTime(0.3, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);
  } catch (e) {}
}

function fmtTime(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m} min ${rem} sec`;
}

function fmtWait(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s <= 5) return '0 min 0 sec (Next)';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m === 0 ? `${r} sec` : r === 0 ? `${m} min` : `${m} min ${r} sec`;
}

function toast(msg, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {}
  }
}

async function triggerBrowserNotification(title, body) {
  playNotificationChime();
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);

  if (!('Notification' in window)) {
    toast(`🔔 ${title}: ${body}`, 'info');
    return;
  }

  if (Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          reg.showNotification(title, {
            body,
            icon: '/logo.svg',
            tag: 'mealsync-queue',
            renotify: true
          });
          return;
        }
      }
      new Notification(title, { body, icon: '/logo.svg', tag: 'mealsync-queue' });
    } catch (e) {
      toast(`🔔 ${title}: ${body}`, 'info');
    }
  } else {
    toast(`🔔 ${title}: ${body}`, 'info');
  }
}

function evaluateNotificationRules(student, counter) {
  if (!student || !counter || !state.notificationsEnabled) return;
  const pos = student.position;

  if (pos === 3 && state.lastNotifiedPosition > 3) {
    state.lastNotifiedPosition = 3;
    triggerBrowserNotification(
      "🔔 Almost your turn!",
      `Only 2 people ahead of you at ${counter.name}! Head over to the counter now.`
    );
    toast(`🔔 Only 2 people ahead at ${counter.name}! Head to the line.`, 'success');
  }

  if (pos === 1 && state.lastNotifiedPosition > 1) {
    state.lastNotifiedPosition = 1;
    triggerBrowserNotification(
      "🍽️ It's your turn!",
      `You are #1 at ${counter.name}! Please collect your food plate.`
    );
    toast(`🍽️ You are #1 at ${counter.name}! Please collect your plate.`, 'success');
  }

  if (pos > 3 && state.lastNotifiedPosition < pos) {
    state.lastNotifiedPosition = pos;
  }
}

async function setupNotificationPermission() {
  if (!('Notification' in window)) {
    toast('Browser does not support notifications. In-app alerts will be used.', 'warning');
    state.notificationsEnabled = true;
    updateNotifyUI();
    return;
  }

  if (Notification.permission === 'granted') {
    state.notificationsEnabled = !state.notificationsEnabled;
    toast(state.notificationsEnabled ? 'Notifications active! You will be alerted when 2 people are ahead.' : 'Notifications paused.');
    updateNotifyUI();
    if (state.notificationsEnabled) {
      triggerBrowserNotification('Notifications Active 🔔', 'We will notify you when 2 people remain ahead of you in line.');
    }
    return;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      state.notificationsEnabled = true;
      toast('Notifications enabled! You will be alerted when 2 people are ahead.', 'success');
      triggerBrowserNotification('Notifications Active 🔔', 'Ready! You will get an alert when 2 people are ahead of you.');
    } else {
      toast('Permission declined. In-app alerts will still be shown.', 'warning');
      state.notificationsEnabled = false;
    }
  } else {
    toast('Notifications are blocked in browser settings. Please allow notifications for this page.', 'warning');
    state.notificationsEnabled = false;
  }
  updateNotifyUI();
}

function updateNotifyUI() {
  const btn = $('btnToggleNotify');
  const sub = $('notifySubtext');
  const bell = $('notifyBellIcon');
  if (!btn) return;

  if (state.notificationsEnabled) {
    btn.className = 'btn-notify-toggle active';
    btn.innerHTML = '🔔 Notifications Active';
    if (sub) sub.textContent = 'Active: Chrome will notify you when 2 students are ahead of you in line!';
    if (bell) bell.style.color = '#10b981';
  } else {
    btn.className = 'btn-notify-toggle';
    btn.innerHTML = '🔔 Notify Me (When 2 Ahead)';
    if (sub) sub.textContent = 'Get a native alert when 2 students are ahead of you in line.';
    if (bell) bell.style.color = '#d97706';
  }
}

function setView(name) {
  state.view = name;
  const views = [
    'viewHome', 'viewStudentLogin', 'viewStaffLogin', 'viewAdminLogin',
    'viewStudentDashboard', 'viewStaffDashboard', 'viewAdminDashboard'
  ];
  views.forEach(id => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });

  if (state.user) {
    $('navAuthBtns').style.display = 'none';
    $('navUserControls').style.display = 'flex';
    $('userNameDisplay').textContent = state.user.name;

    const roleBadge = $('userRoleBadge');
    const idDisplay = $('userIdDisplay');

    if (state.user.role === 'student') {
      roleBadge.textContent = 'Student';
      roleBadge.className = 'user-role-badge student';
      idDisplay.textContent = `(${state.user.id})`;
    } else if (state.user.role === 'staff') {
      roleBadge.textContent = 'Staff';
      roleBadge.className = 'user-role-badge staff';
      idDisplay.textContent = `(ID: ${state.user.rollNo || state.user.id})`;
    } else if (state.user.role === 'admin') {
      roleBadge.textContent = 'Admin';
      roleBadge.className = 'user-role-badge admin';
      idDisplay.textContent = `(${state.user.id})`;
    }
  } else {
    $('navAuthBtns').style.display = 'flex';
    $('navUserControls').style.display = 'none';
  }

  if (name === 'home') {
    $('viewHome').style.display = 'block';
    renderHomeStats();
    renderHomeMenu();
    updateSessionPill();
  } else if (name === 'studentLogin') {
    $('viewStudentLogin').style.display = 'block';
    $('loginStudentName').focus();
  } else if (name === 'staffLogin') {
    $('viewStaffLogin').style.display = 'block';
    $('loginStaffName').focus();
  } else if (name === 'adminLogin') {
    $('viewAdminLogin').style.display = 'block';
    $('loginAdminName').focus();
  } else if (name === 'studentDashboard') {
    $('viewStudentDashboard').style.display = 'block';
    renderTicket();
    renderStudentCounters();
    updateNotifyUI();
  } else if (name === 'staffDashboard') {
    $('viewStaffDashboard').style.display = 'block';
    renderStaffCounters();
  } else if (name === 'adminDashboard') {
    $('viewAdminDashboard').style.display = 'block';
    fetchAdminOverview();
    fetchSchedules();
  }
}

function initSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('mealsync_session'));
    if (saved && saved.role) {
      state.user = saved;
      if (saved.role === 'student') setView('studentDashboard');
      else if (saved.role === 'staff') setView('staffDashboard');
      else if (saved.role === 'admin') setView('adminDashboard');
      return;
    }
  } catch (e) {}
  setView('home');
}

function logout() {
  state.user = null;
  state.notificationsEnabled = false;
  state.lastNotifiedPosition = 999;
  localStorage.removeItem('mealsync_session');
  state.queueStatus = { inQueue: false, counter: null, student: null };
  toast('Logged out.');
  setView('home');
}

async function fetchCounters() {
  try {
    const res = await fetch('/api/counters');
    const data = await res.json();
    if (data.success) {
      state.counters = data.counters;
      if (data.activeSlot !== undefined) state.activeSlot = data.activeSlot;
      if (data.upcomingSlot !== undefined) state.upcomingSlot = data.upcomingSlot;
      if (data.announcement !== undefined) {
        state.announcement = data.announcement;
        renderAnnouncement();
      }
      renderHomeStats();
      renderHomeMenu();
      updateSessionPill();
      renderTicket();
      renderStudentCounters();
      renderStaffCounters();
      if (state.view === 'adminDashboard' && state.adminTab === 'moderation') {
        fetchAdminOverview();
      }
    }
  } catch (e) {}
}

async function checkStudentStatus() {
  if (!state.user || state.user.role !== 'student') return;
  try {
    const res = await fetch(`/api/student-status?studentId=${encodeURIComponent(state.user.id)}`);
    const data = await res.json();
    state.queueStatus = data;
    renderTicket();
    renderStudentCounters();
    if (data.inQueue && data.student && data.counter) {
      evaluateNotificationRules(data.student, data.counter);
    } else {
      state.lastNotifiedPosition = 999;
    }
  } catch (e) {}
}

async function fetchAnnouncement() {
  try {
    const res = await fetch('/api/settings');
    const d = await res.json();
    if (d.success && d.settings) {
      state.announcement = d.settings.announcement;
      renderAnnouncement();
    }
  } catch (e) {}
}

function renderAnnouncement() {
  const bar = $('globalAnnouncementBanner');
  const txt = $('announcementText');
  if (!bar || !txt) return;
  if (state.announcement && state.announcement.trim()) {
    txt.textContent = state.announcement;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

async function fetchSchedules() {
  try {
    const res = await fetch('/api/schedules');
    const data = await res.json();
    if (data.success) {
      state.schedules = data.schedules || [];
      state.activeSlot = data.activeSlot || null;
      state.upcomingSlot = data.upcomingSlot || null;
      renderSchedulesTable();
      updateSessionPill();
    }
  } catch (e) {}
}

function updateSessionPill() {
  const pill = $('homeActiveSessionTag');
  const txt = $('homeSessionText');
  if (!pill || !txt) return;

  if (state.activeSlot) {
    txt.textContent = `Active Session: ${state.activeSlot.mealName} (${state.activeSlot.startTime} - ${state.activeSlot.endTime})`;
    pill.style.display = 'inline-flex';
  } else if (state.upcomingSlot) {
    txt.textContent = `Upcoming: ${state.upcomingSlot.mealName} (${state.upcomingSlot.startTime} - ${state.upcomingSlot.endTime})`;
    pill.style.display = 'inline-flex';
  } else {
    pill.style.display = 'none';
  }
}

function renderSchedulesTable() {
  const tbody = $('schedulesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!state.schedules || !state.schedules.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1.5rem;">No scheduled slots defined.</td></tr>';
    return;
  }

  state.schedules.forEach(s => {
    const isActive = state.activeSlot && state.activeSlot.id === s.id;
    let statusBadge = '<span class="sched-tag disabled">Inactive</span>';
    if (s.enabled) {
      statusBadge = isActive
        ? '<span class="sched-tag active">Active Now</span>'
        : '<span class="sched-tag scheduled">Scheduled</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${s.mealName}</strong></td>
      <td><code>${s.startTime} - ${s.endTime}</code></td>
      <td>${s.days || 'Daily'}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn-admin-small ${s.enabled ? 'warn' : 'success'}" onclick="adminToggleSchedule('${s.id}')">
          ${s.enabled ? 'Pause' : 'Enable'}
        </button>
        <button class="btn-admin-small danger" style="margin-left:0.3rem;" onclick="adminDeleteSchedule('${s.id}', '${s.mealName}')">
          Delete
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.adminToggleSchedule = async function(id) {
  try {
    const res = await fetch(`/api/admin/schedules/${id}/toggle`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      toast('Schedule updated.');
      fetchSchedules();
    }
  } catch (e) {}
};

window.adminDeleteSchedule = async function(id, name) {
  if (!confirm(`Delete "${name}" schedule?`)) return;
  try {
    const res = await fetch(`/api/admin/schedules/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.success) {
      toast(d.message);
      fetchSchedules();
    }
  } catch (e) {}
};

function renderHomeMenu() {
  const section = $('homeMenuSection');
  const grid = $('homeMenuGrid');
  if (!section || !grid) return;

  grid.innerHTML = '';

  const countersWithMenu = state.counters.filter(c => {
    if (!c.menu || !Array.isArray(c.menu)) return false;
    const validItems = c.menu.filter(item => item && String(item).trim().length > 0);
    return validItems.length > 0;
  });

  if (countersWithMenu.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  countersWithMenu.forEach(c => {
    const isVeg = c.foodType === 'veg';
    const validItems = c.menu.filter(item => item && String(item).trim().length > 0);

    const card = document.createElement('div');
    card.className = 'menu-counter-card';
    card.innerHTML = `
      <div class="menu-card-header">
        <strong>${c.name}</strong>
        <span class="badge-food-pill ${isVeg ? 'veg' : 'non-veg'}">${isVeg ? 'Veg' : 'Non-Veg'}</span>
      </div>
      <ul class="menu-dishes-list">
        ${validItems.map(dish => `<li>${dish.trim()}</li>`).join('')}
      </ul>
    `;
    grid.appendChild(card);
  });
}

function renderHomeStats() {
  let qTotal = 0, servedTotal = 0, paceSum = 0;
  state.counters.forEach(c => {
    qTotal += c.queueLength || 0;
    servedTotal += c.totalServed || 0;
    paceSum += c.avgServeSeconds || 40;
  });
  const count = state.counters.length;
  if ($('homeStatActiveCounters')) $('homeStatActiveCounters').textContent = count;
  if ($('homeStatTotalQueue')) $('homeStatTotalQueue').textContent = qTotal;
  if ($('homeStatAvgPace')) $('homeStatAvgPace').textContent = (count > 0 ? Math.round(paceSum / count) : 40) + 's';
  if ($('homeStatMealsServed')) $('homeStatMealsServed').textContent = servedTotal;
}

function renderTicket() {
  const wrap = $('activeTicketWrapper');
  if (!wrap) return;

  if (!state.queueStatus.inQueue || !state.queueStatus.counter) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  const { counter, student } = state.queueStatus;

  $('ticketLineName').textContent = counter.name;
  $('ticketStaffName').textContent = counter.staffName || 'Staff';
  $('ticketStaffRoll').textContent = counter.staffRollNo || '50101';
  $('ticketMaxCapacity').textContent = counter.maxQueueSize || 20;

  const isVeg = counter.foodType === 'veg';
  $('ticketFoodBadge').className = `badge-food-pill ${isVeg ? 'veg' : 'non-veg'}`;
  $('ticketFoodBadge').textContent = isVeg ? 'Pure Veg' : 'Non-Veg';

  $('ticketPosition').textContent = `#${student.position}`;
  $('ticketPositionNote').textContent = student.position === 1
    ? 'You are next in line! Collect your meal.'
    : (student.position === 3 ? '🔔 Only 2 people ahead of you!' : `${student.position - 1} student(s) ahead of you`);

  const estSec = Math.max(0, (student.position - 1) * (counter.avgServeSeconds || 40));
  $('ticketCountdown').textContent = fmtWait(estSec);
  $('ticketPaceNote').textContent = `Speed: ~${counter.avgServeSeconds || 40}s per student`;

  const elapsed = Math.max(0, Math.floor((Date.now() - student.joinedAt) / 1000));
  $('ticketElapsed').textContent = fmtTime(elapsed);

  const menuItems = (counter.menu || []).filter(m => m && String(m).trim().length > 0);
  $('ticketMenuList').textContent = menuItems.length ? menuItems.join(', ') : 'Daily Mess Meal';
}

function renderStudentCounters() {
  const cont = $('studentCountersContainer');
  if (!cont) return;
  cont.innerHTML = '';

  const list = state.counters.filter(c => state.filter === 'all' || c.foodType === state.filter);
  if (!list.length) {
    cont.innerHTML = '<div class="empty-state-card"><p>No mess counters available.</p></div>';
    return;
  }

  const userCounterId = state.queueStatus.inQueue && state.queueStatus.counter ? state.queueStatus.counter.id : null;

  list.forEach(c => {
    const isCurrent = userCounterId === c.id;
    const isVeg = c.foodType === 'veg';
    const qLen = c.queueLength || 0;
    const maxQ = c.maxQueueSize || 20;
    const isFull = qLen >= maxQ;
    const pct = Math.min(100, Math.round((qLen / maxQ) * 100));

    let capacityClass = 'low';
    if (pct >= 90) capacityClass = 'danger';
    else if (pct >= 60) capacityClass = 'warn';

    let actionBtn = '';
    if (isCurrent) {
      actionBtn = `<div class="status-action-tag in-queue">In Queue (#${state.queueStatus.student.position})</div>`;
    } else if (isFull) {
      actionBtn = `<button class="btn-card-action disabled" disabled>Queue Full (Max ${maxQ})</button>`;
    } else if (state.queueStatus.inQueue) {
      actionBtn = `<button class="btn-card-action switch" onclick="joinLine('${c.id}')">Switch Line</button>`;
    } else {
      actionBtn = `<button class="btn-card-action join" onclick="joinLine('${c.id}')">Join Line</button>`;
    }

    const menuItems = (c.menu || []).filter(m => m && String(m).trim().length > 0);
    const menuSnippet = menuItems.length ? `<strong>Menu:</strong> ${menuItems.join(', ')}` : '';

    const card = document.createElement('div');
    card.className = `counter-item-card ${isCurrent ? 'selected-current' : ''}`;
    card.innerHTML = `
      <div class="counter-card-header">
        <div>
          <div class="counter-card-title">${c.name}</div>
          <div class="counter-card-staff">Staff: ${c.staffName || 'Staff'} (ID: ${c.staffRollNo || '50101'})</div>
        </div>
        <span class="badge-food-pill ${isVeg ? 'veg' : 'non-veg'}">${isVeg ? 'Veg' : 'Non-Veg'}</span>
      </div>

      ${menuSnippet ? `<div class="counter-menu-snippet">${menuSnippet}</div>` : ''}

      <div class="capacity-meter-box">
        <div class="capacity-labels-row">
          <span>Capacity: <strong>${qLen} / ${maxQ}</strong></span>
          <span class="capacity-pct ${capacityClass}">${pct}% full</span>
        </div>
        <div class="capacity-bar-track">
          <div class="capacity-bar-fill ${capacityClass}" style="width: ${pct}%;"></div>
        </div>
      </div>

      <div class="counter-card-footer">
        <div class="wait-preview">
          <span class="wait-label">Est. Wait:</span>
          <strong>${fmtWait(c.nextWaitEstimateSeconds || (qLen * (c.avgServeSeconds || 40)))}</strong>
        </div>
        ${actionBtn}
      </div>
    `;
    cont.appendChild(card);
  });
}

function renderStaffCounters() {
  const cont = $('staffCountersContainer');
  if (!cont) return;
  cont.innerHTML = '';

  if (!state.counters.length) {
    cont.innerHTML = `
      <div class="empty-state-card">
        <p>No mess counters are currently open.</p>
        <button class="btn-primary-action" onclick="openCreateModal()">Start First Counter</button>
      </div>
    `;
    return;
  }

  state.counters.forEach(c => {
    const isVeg = c.foodType === 'veg';
    const q = c.queue || [];
    const next = q[0];
    const maxQ = c.maxQueueSize || 20;

    const serveCard = next ? `
      <div class="staff-serve-card-active">
        <div class="serve-meta-info">
          <span class="token-up-pill">Next in line (#1)</span>
          <div class="serve-student-name">${next.studentName}</div>
          <div class="serve-student-id">Roll: <code>${next.studentId}</code></div>
          <div class="serve-wait-ticker">In line: <strong class="live-wait-timer" data-joined="${next.joinedAt}">${fmtTime((Date.now() - next.joinedAt)/1000)}</strong></div>
        </div>
        <button class="btn-serve-action" onclick="serveNext('${c.id}')">
          Serve Next (Dequeue)
        </button>
      </div>
    ` : `
      <div class="staff-serve-card-empty">
        <div class="empty-text">Queue is empty. Waiting for students.</div>
        <button class="btn-serve-action disabled" disabled>Queue Empty</button>
      </div>
    `;

    const queueRows = q.length ? q.map((s, idx) => `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td>${s.studentName}</td>
        <td><code>${s.studentId}</code></td>
        <td><span class="live-wait-timer" data-joined="${s.joinedAt}">${fmtTime((Date.now() - s.joinedAt)/1000)}</span></td>
        <td>${fmtWait(idx * (c.avgServeSeconds || 40))}</td>
      </tr>
    `).join('') : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:1rem;">No students in queue.</td></tr>';

    const card = document.createElement('div');
    card.className = 'staff-counter-card';
    card.innerHTML = `
      <div class="staff-card-header">
        <div>
          <div class="staff-line-title">
            <span>${c.name}</span>
            <span class="badge-food-pill ${isVeg ? 'veg' : 'non-veg'}">${isVeg ? 'Veg' : 'Non-Veg'}</span>
          </div>
          <div class="staff-sub-info">
            Staff: ${c.staffName || 'Staff'} (${c.staffRollNo || '50101'})
          </div>
        </div>

        <div class="staff-header-actions">
          <span class="staff-pace-tag">Pace: ~${c.avgServeSeconds || 40}s</span>
          <span class="staff-cap-tag">Cap: ${q.length}/${maxQ}</span>
          <button class="btn-pause-counter" onclick="closeCounter('${c.id}')">Close</button>
        </div>
      </div>

      <div class="staff-serve-hero-wrap">
        ${serveCard}
      </div>

      <div class="queue-roster-header">
        <h4>Current Queue (${q.length})</h4>
      </div>

      <div class="table-responsive-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Student</th>
              <th>Roll No</th>
              <th>Time In Line</th>
              <th>Est. Ready</th>
            </tr>
          </thead>
          <tbody>${queueRows}</tbody>
        </table>
      </div>
    `;
    cont.appendChild(card);
  });
}

setInterval(() => {
  if (state.queueStatus.inQueue && state.queueStatus.student) {
    const elapsed = Math.max(0, Math.floor((Date.now() - state.queueStatus.student.joinedAt) / 1000));
    if ($('ticketElapsed')) $('ticketElapsed').textContent = fmtTime(elapsed);
  }
  document.querySelectorAll('.live-wait-timer').forEach(el => {
    const j = parseInt(el.getAttribute('data-joined'), 10);
    if (!isNaN(j)) el.textContent = fmtTime((Date.now() - j) / 1000);
  });
}, 1000);

window.joinLine = async function(id) {
  if (!state.user || state.user.role !== 'student') {
    toast('Please log in as a student to join.', 'warning');
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
      state.lastNotifiedPosition = 999;
      if ($('ticketElapsed')) $('ticketElapsed').textContent = '0 min 0 sec';
      await fetchCounters();
      await checkStudentStatus();
    } else {
      toast(d.message || 'Error joining line.', 'danger');
    }
  } catch (e) {
    toast('Network error.', 'danger');
  }
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
      state.lastNotifiedPosition = 999;
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
      toast(`Served ${d.servedStudent.studentName} (${d.durationSeconds}s).`, 'success');
      await fetchCounters();
      await checkStudentStatus();
    } else {
      toast(d.message || 'Error serving student.', 'warning');
    }
  } catch (e) {
    toast('Network error.', 'danger');
  }
};

window.closeCounter = async function(id) {
  if (!confirm('Close this counter line?')) return;
  try {
    const res = await fetch(`/api/counters/${id}/close`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      toast(d.message);
      await fetchCounters();
      if (state.view === 'adminDashboard') fetchAdminOverview();
    }
  } catch (e) {}
};

async function fetchAdminOverview() {
  try {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (data.success) {
      state.adminOverview = data;
      renderAdminStats(data.stats);
      renderAdminModeration(data.counters);
      if (data.schedules) {
        state.schedules = data.schedules;
        renderSchedulesTable();
      }
    }
  } catch (e) {}
}

function renderAdminStats(stats) {
  if (!stats) return;
  if ($('adminPillMaxQ')) $('adminPillMaxQ').textContent = stats.defaultMaxQueueSize || 20;
  if ($('adminPillTotalServes')) $('adminPillTotalServes').textContent = stats.totalServesAllTime || 0;
  if ($('inputGlobalMaxQueue')) $('inputGlobalMaxQueue').value = stats.defaultMaxQueueSize || 20;
  if ($('inputAdminAnnouncement')) $('inputAdminAnnouncement').value = stats.announcement || '';
}

function renderAdminModeration(countersList) {
  const cont = $('adminCountersModerationList');
  if (!cont) return;
  cont.innerHTML = '';

  const select = $('auditCounterSelect');
  if (select) {
    const cur = select.value;
    select.innerHTML = '<option value="">All Counters</option>' + (countersList || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    select.value = cur;
  }

  if (!countersList || !countersList.length) {
    cont.innerHTML = '<div class="empty-state-card"><p>No counters available.</p></div>';
    return;
  }

  countersList.forEach(c => {
    const isActive = c.status === 'active';
    const isVeg = c.foodType === 'veg';
    const q = c.queue || [];
    const maxQ = c.maxQueueSize || 20;

    const studentRows = q.length ? q.map((s, idx) => `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td>${s.studentName}</td>
        <td><code>${s.studentId}</code></td>
        <td><span class="live-wait-timer" data-joined="${s.joinedAt}">${fmtTime((Date.now() - s.joinedAt)/1000)}</span></td>
        <td>
          <button class="btn-kick-student" onclick="adminKickStudent('${c.id}', '${s.studentId}', '${encodeURIComponent(s.studentName)}')">
            ✕ Remove
          </button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:0.75rem;">No students in queue.</td></tr>';

    const div = document.createElement('div');
    div.className = `admin-counter-mod-card ${isActive ? 'active' : 'closed'}`;
    div.innerHTML = `
      <div class="admin-mod-header">
        <div>
          <div class="admin-mod-title">
            <span>${c.name}</span>
            <span class="badge-status-pill ${isActive ? 'active' : 'closed'}">${isActive ? 'Active' : 'Closed'}</span>
            <span class="badge-food-pill ${isVeg ? 'veg' : 'non-veg'}">${isVeg ? 'Veg' : 'Non-Veg'}</span>
          </div>
          <div class="admin-mod-sub">
            Staff: ${c.staffName || 'Staff'} (Roll: ${c.staffRollNo || '50101'})
          </div>
        </div>

        <div class="admin-mod-actions">
          ${isActive
            ? `<button class="btn-admin-small warn" onclick="closeCounter('${c.id}')">Pause Line</button>`
            : `<button class="btn-admin-small success" onclick="adminReopenCounter('${c.id}')">Reopen Line</button>`
          }
          <button class="btn-admin-small danger" onclick="adminDeleteCounter('${c.id}', '${c.name}')">Delete</button>
        </div>
      </div>

      <div class="admin-counter-controls-bar">
        <div class="inline-config-group">
          <label>Max Queue Limit:</label>
          <input type="number" min="1" max="100" value="${maxQ}" id="counterMaxQ_${c.id}" class="form-input small">
          <button class="btn-admin-small primary" onclick="adminSaveCounterLimit('${c.id}')">Save Limit</button>
        </div>

        <div class="queue-summary-tag">
          In line: <strong>${q.length} / ${maxQ}</strong>
          ${q.length > 0 ? `<button class="btn-admin-small danger" style="margin-left:0.5rem;" onclick="adminClearQueue('${c.id}', '${c.name}')">Clear Line</button>` : ''}
        </div>
      </div>

      <div class="admin-roster-box">
        <table class="data-table small">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Student</th>
              <th>Roll No</th>
              <th>Time In Line</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${studentRows}</tbody>
        </table>
      </div>
    `;
    cont.appendChild(div);
  });
}

window.adminReopenCounter = async function(id) {
  try {
    const res = await fetch(`/api/admin/counters/${id}/reopen`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      toast(d.message, 'success');
      fetchAdminOverview();
      fetchCounters();
    }
  } catch (e) {}
};

window.adminDeleteCounter = async function(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const res = await fetch(`/api/admin/counters/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.success) {
      toast(d.message);
      fetchAdminOverview();
      fetchCounters();
    }
  } catch (e) {}
};

window.adminSaveCounterLimit = async function(id) {
  const input = $(`counterMaxQ_${id}`);
  if (!input) return;
  const maxQueueSize = parseInt(input.value, 10);
  if (!maxQueueSize || maxQueueSize < 1) return;
  try {
    const res = await fetch(`/api/admin/counters/${id}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxQueueSize })
    });
    const d = await res.json();
    if (d.success) {
      toast(`Queue limit set to ${maxQueueSize}.`, 'success');
      fetchAdminOverview();
      fetchCounters();
    }
  } catch (e) {}
};

window.adminKickStudent = async function(counterId, studentId, studentName) {
  const decodedName = decodeURIComponent(studentName);
  if (!confirm(`Remove ${decodedName} (${studentId}) from line?`)) return;
  try {
    const res = await fetch(`/api/admin/counters/${counterId}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId })
    });
    const d = await res.json();
    if (d.success) {
      toast(d.message, 'success');
      fetchAdminOverview();
      fetchCounters();
    }
  } catch (e) {}
};

window.adminClearQueue = async function(counterId, counterName) {
  if (!confirm(`Clear all students from ${counterName}?`)) return;
  try {
    const res = await fetch(`/api/admin/counters/${counterId}/clear`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      toast(d.message);
      fetchAdminOverview();
      fetchCounters();
    }
  } catch (e) {}
};

async function fetchAuditLogs() {
  const search = $('auditSearchInput') ? $('auditSearchInput').value.trim() : '';
  const counterId = $('auditCounterSelect') ? $('auditCounterSelect').value : '';
  const foodType = $('auditFoodSelect') ? $('auditFoodSelect').value : 'all';

  const params = new URLSearchParams();
  if (search) params.append('query', search);
  if (counterId) params.append('counterId', counterId);
  if (foodType && foodType !== 'all') params.append('foodType', foodType);
  params.append('limit', '150');

  try {
    const res = await fetch(`/api/admin/serves?${params.toString()}`);
    const data = await res.json();
    if (data.success) {
      renderAuditLogsTable(data.serves);
    }
  } catch (e) {}
}

function renderAuditLogsTable(serves) {
  const tbody = $('auditServesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!serves || !serves.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:2rem;">No meal serve records found.</td></tr>';
    return;
  }

  serves.forEach(s => {
    const isVeg = s.foodType === 'veg';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><small style="color:#64748b;">${s.servedAt || new Date(s.timestamp).toLocaleTimeString()}</small></td>
      <td><strong>${s.studentName}</strong></td>
      <td><code>${s.studentId}</code></td>
      <td>
        <span>${s.counterName}</span>
        <span class="badge-food-pill ${isVeg ? 'veg' : 'non-veg'}" style="margin-left:0.3rem;">${isVeg ? 'Veg' : 'Non-Veg'}</span>
      </td>
      <td>${s.staffName} <small style="color:#64748b;">(${s.staffRollNo || '50101'})</small></td>
      <td>${fmtTime(s.waitTimeSeconds || 0)}</td>
      <td>${s.durationSeconds || 40}s</td>
    `;
    tbody.appendChild(tr);
  });
}

$('loginStudentId').addEventListener('input', (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 10);
  e.target.value = v;
  $('studentRegCounter').textContent = `${v.length} / 10 digits entered`;
  if (v.length === 10) $('studentRegFeedback').style.display = 'none';
});

$('studentLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('loginStudentName').value.trim();
  const regNo = $('loginStudentId').value.trim();
  if (!name) return;
  if (!/^\d{10}$/.test(regNo)) {
    $('studentRegFeedback').style.display = 'block';
    $('loginStudentId').focus();
    return;
  }

  try {
    const res = await fetch('/api/auth/student-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName: name, studentId: regNo })
    });
    const d = await res.json();
    if (d.success) {
      state.user = { role: 'student', name, id: regNo };
      localStorage.setItem('mealsync_session', JSON.stringify(state.user));
      toast(`Welcome, ${name}!`, 'success');
      setView('studentDashboard');
      fetchCounters();
      checkStudentStatus();
    } else {
      toast(d.message || 'Login failed.', 'danger');
    }
  } catch (err) {
    toast('Network error.', 'danger');
  }
});

$('loginStaffRollNo').addEventListener('input', (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 5);
  e.target.value = v;
  $('staffRollCounter').textContent = `${v.length} / 5 digits entered`;
  if (v.length === 5) $('staffRollFeedback').style.display = 'none';
});

$('staffLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('loginStaffName').value.trim();
  const rollNo = $('loginStaffRollNo').value.trim();
  if (!name) return;
  if (!/^\d{5}$/.test(rollNo)) {
    $('staffRollFeedback').style.display = 'block';
    $('loginStaffRollNo').focus();
    return;
  }

  try {
    const res = await fetch('/api/auth/staff-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffName: name, staffRollNo: rollNo })
    });
    const d = await res.json();
    if (d.success) {
      state.user = { role: 'staff', name, id: rollNo, rollNo };
      localStorage.setItem('mealsync_session', JSON.stringify(state.user));
      toast(`Logged in as staff: ${name}`, 'success');
      setView('staffDashboard');
      fetchCounters();
    } else {
      toast(d.message || 'Login failed.', 'danger');
    }
  } catch (err) {
    toast('Network error.', 'danger');
  }
});

$('loginAdminCode').addEventListener('input', (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 5);
  e.target.value = v;
  $('adminCodeCounter').textContent = `${v.length} / 5 digits entered`;
  if (v.length === 5) $('adminCodeFeedback').style.display = 'none';
});

$('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('loginAdminName').value.trim();
  const code = $('loginAdminCode').value.trim();
  if (!name) return;
  if (!/^\d{5}$/.test(code)) {
    $('adminCodeFeedback').style.display = 'block';
    $('loginAdminCode').focus();
    return;
  }

  try {
    const res = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminName: name, adminCode: code })
    });
    const d = await res.json();
    if (d.success) {
      state.user = { role: 'admin', name, id: code };
      localStorage.setItem('mealsync_session', JSON.stringify(state.user));
      toast(`Admin logged in: ${name}`, 'success');
      setView('adminDashboard');
    } else {
      toast(d.message || 'Login failed.', 'danger');
    }
  } catch (err) {
    toast('Network error.', 'danger');
  }
});

window.fillStudentDemo = (name, reg) => {
  $('loginStudentName').value = name;
  $('loginStudentId').value = reg;
  $('studentRegCounter').textContent = '10 / 10 digits entered';
  $('studentRegFeedback').style.display = 'none';
};

window.fillStaffDemo = (name, roll) => {
  $('loginStaffName').value = name;
  $('loginStaffRollNo').value = roll;
  $('staffRollCounter').textContent = '5 / 5 digits entered';
  $('staffRollFeedback').style.display = 'none';
};

window.fillAdminDemo = (name, code) => {
  $('loginAdminName').value = name;
  $('loginAdminCode').value = code;
  $('adminCodeCounter').textContent = '5 / 5 digits entered';
  $('adminCodeFeedback').style.display = 'none';
};

$('formAdminQueueSize').addEventListener('submit', async (e) => {
  e.preventDefault();
  const defaultMaxQueueSize = parseInt($('inputGlobalMaxQueue').value, 10);
  if (!defaultMaxQueueSize || defaultMaxQueueSize < 1) return;
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultMaxQueueSize })
    });
    const d = await res.json();
    if (d.success) {
      toast(`Default max queue size set to ${defaultMaxQueueSize}.`, 'success');
      fetchAdminOverview();
      fetchCounters();
    }
  } catch (err) {}
});

$('formAdminAnnouncement').addEventListener('submit', async (e) => {
  e.preventDefault();
  const announcement = $('inputAdminAnnouncement').value.trim();
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcement })
    });
    const d = await res.json();
    if (d.success) {
      state.announcement = announcement;
      renderAnnouncement();
      toast('Announcement published.', 'success');
    }
  } catch (err) {}
});

$('btnClearAnnouncement').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcement: '' })
    });
    const d = await res.json();
    if (d.success) {
      state.announcement = '';
      if ($('inputAdminAnnouncement')) $('inputAdminAnnouncement').value = '';
      renderAnnouncement();
      toast('Notice cleared.');
    }
  } catch (err) {}
});

$('formAddSchedule').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mealName = $('schedMealName').value.trim();
  const startTime = $('schedStartTime').value.trim();
  const endTime = $('schedEndTime').value.trim();
  const days = $('schedDays').value.trim();
  if (!mealName || !startTime || !endTime) return;

  try {
    const res = await fetch('/api/admin/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealName, startTime, endTime, days })
    });
    const d = await res.json();
    if (d.success) {
      toast(`Scheduled "${mealName}".`, 'success');
      $('formAddSchedule').reset();
      $('schedDays').value = 'Daily';
      fetchSchedules();
    } else {
      toast(d.message || 'Error saving schedule.', 'danger');
    }
  } catch (err) {
    toast('Network error.', 'danger');
  }
});

window.openCreateModal = () => $('createCounterModal').classList.add('open');
window.closeCreateModal = () => $('createCounterModal').classList.remove('open');

$('createCounterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('inputLineName').value.trim();
  const foodType = document.querySelector('input[name="foodType"]:checked').value;
  const staffName = $('inputStaffName').value.trim();
  const staffRollNo = $('inputStaffRollNo').value.trim();
  const maxQueueSize = parseInt($('inputMaxQueue').value, 10) || 20;
  const menu = $('inputMenu').value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/counters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, foodType, staffName, staffRollNo, maxQueueSize, menu })
    });
    const d = await res.json();
    if (d.success) {
      toast(`Counter "${name}" created.`, 'success');
      $('createCounterForm').reset();
      closeCreateModal();
      await fetchCounters();
    }
  } catch (e) {
    toast('Error creating counter.', 'danger');
  }
});

function setAdminTab(tabName) {
  state.adminTab = tabName;
  ['tabBtnModeration', 'tabBtnScheduling', 'tabBtnSettings', 'tabBtnAuditLogs'].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove('active');
  });
  ['adminTabContentModeration', 'adminTabContentScheduling', 'adminTabContentSettings', 'adminTabContentAuditLogs'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });

  if (tabName === 'moderation') {
    $('tabBtnModeration').classList.add('active');
    $('adminTabContentModeration').style.display = 'block';
    fetchAdminOverview();
  } else if (tabName === 'scheduling') {
    $('tabBtnScheduling').classList.add('active');
    $('adminTabContentScheduling').style.display = 'block';
    fetchSchedules();
  } else if (tabName === 'settings') {
    $('tabBtnSettings').classList.add('active');
    $('adminTabContentSettings').style.display = 'block';
  } else if (tabName === 'auditLogs') {
    $('tabBtnAuditLogs').classList.add('active');
    $('adminTabContentAuditLogs').style.display = 'block';
    fetchAuditLogs();
  }
}

$('navBrand').addEventListener('click', () => setView('home'));
$('btnNavStudentLogin').addEventListener('click', () => setView('studentLogin'));
$('btnNavStaffLogin').addEventListener('click', () => setView('staffLogin'));
$('btnNavAdminLogin').addEventListener('click', () => setView('adminLogin'));
$('heroBtnStudent').addEventListener('click', () => setView('studentLogin'));
$('heroBtnStaff').addEventListener('click', () => setView('staffLogin'));
$('heroBtnAdmin').addEventListener('click', () => setView('adminLogin'));
$('btnLogout').addEventListener('click', logout);

$('btnBackFromStudentLogin').addEventListener('click', () => setView('home'));
$('btnBackFromStaffLogin').addEventListener('click', () => setView('home'));
$('btnBackFromAdminLogin').addEventListener('click', () => setView('home'));

$('btnOpenCreateCounterModal').addEventListener('click', openCreateModal);
$('btnCloseCreateModal').addEventListener('click', closeCreateModal);
$('btnCancelCreateModal').addEventListener('click', closeCreateModal);

$('btnLeaveActiveQueue').addEventListener('click', () => {
  if (state.queueStatus.counter) leaveLine(state.queueStatus.counter.id);
});

$('btnToggleNotify').addEventListener('click', setupNotificationPermission);
$('btnTestNotify').addEventListener('click', () => {
  triggerBrowserNotification('Test Notification 🔔', 'This is a test alert from MealSync. Chrome notifications are working!');
});

$('btnCloseAnnouncement').addEventListener('click', () => {
  $('globalAnnouncementBanner').style.display = 'none';
});

$('tabBtnModeration').addEventListener('click', () => setAdminTab('moderation'));
$('tabBtnScheduling').addEventListener('click', () => setAdminTab('scheduling'));
$('tabBtnSettings').addEventListener('click', () => setAdminTab('settings'));
$('tabBtnAuditLogs').addEventListener('click', () => setAdminTab('auditLogs'));
$('btnRefreshAdminOverview').addEventListener('click', fetchAdminOverview);

$('btnApplyAuditFilters').addEventListener('click', fetchAuditLogs);
$('auditSearchInput').addEventListener('keyup', (e) => { if (e.key === 'Enter') fetchAuditLogs(); });
$('auditCounterSelect').addEventListener('change', fetchAuditLogs);
$('auditFoodSelect').addEventListener('change', fetchAuditLogs);

$('filterAllBtn').addEventListener('click', () => {
  state.filter = 'all';
  $('filterAllBtn').classList.add('active');
  $('filterVegBtn').classList.remove('active');
  $('filterNonVegBtn').classList.remove('active');
  renderStudentCounters();
});

$('filterVegBtn').addEventListener('click', () => {
  state.filter = 'veg';
  $('filterAllBtn').classList.remove('active');
  $('filterVegBtn').classList.add('active');
  $('filterNonVegBtn').classList.remove('active');
  renderStudentCounters();
});

$('filterNonVegBtn').addEventListener('click', () => {
  state.filter = 'non-veg';
  $('filterAllBtn').classList.remove('active');
  $('filterVegBtn').classList.remove('active');
  $('filterNonVegBtn').classList.add('active');
  renderStudentCounters();
});

function isMealSyncHealth(data) {
  return !!(data && (data.status === 'healthy' || data.service === 'MealSync API'));
}

async function probeBackend() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (res.ok && isMealSyncHealth(data)) {
      updateLiveStatus(true, 'System Connected');
      return true;
    }
    updateLiveStatus(false, 'Render is not running MealSync API');
    return false;
  } catch (e) {
    updateLiveStatus(false, 'Connecting to Render...');
    return false;
  }
}

let sseHandle = null;
let sseRetryMs = 1000;

function setupSSE() {
  try {
    if (sseHandle) {
      sseHandle.close();
      sseHandle = null;
    }
    const sseUrl = getApiUrl('/api/stream');
    const es = new EventSource(sseUrl);
    sseHandle = es;

    es.onopen = () => {
      sseRetryMs = 1000;
      updateLiveStatus(true);
    };

    es.onerror = () => {
      updateLiveStatus(false, 'Connecting to Render...');
      es.close();
      sseHandle = null;
      setTimeout(() => setupSSE(), sseRetryMs);
      sseRetryMs = Math.min(sseRetryMs * 2, 15000);
    };

    es.addEventListener('connected', () => {
      sseRetryMs = 1000;
      updateLiveStatus(true);
    });

    es.addEventListener('ping', () => {
      updateLiveStatus(true);
    });

    es.addEventListener('queue_updated', () => {
      updateLiveStatus(true);
      fetchCounters();
      checkStudentStatus();
      if (state.view === 'adminDashboard') fetchAdminOverview();
    });

    es.addEventListener('counters_updated', () => {
      updateLiveStatus(true);
      fetchCounters();
      checkStudentStatus();
      if (state.view === 'adminDashboard') fetchAdminOverview();
    });

    es.addEventListener('schedules_updated', () => {
      updateLiveStatus(true);
      fetchSchedules();
      fetchCounters();
    });

    es.addEventListener('settings_updated', (e) => {
      updateLiveStatus(true);
      try {
        const d = JSON.parse(e.data);
        if (d.announcement !== undefined) {
          state.announcement = d.announcement;
          renderAnnouncement();
        }
      } catch (err) {}
      fetchCounters();
    });

    es.addEventListener('student_served', (e) => {
      updateLiveStatus(true);
      try {
        const payload = JSON.parse(e.data);
        if (state.user && state.user.role === 'student' && payload.servedStudent && payload.servedStudent.studentId === state.user.id) {
          triggerBrowserNotification(
            "🍽️ Your Meal is Ready!",
            `Your token has been served at ${payload.counterName}.`
          );
        }
      } catch (err) {}
      fetchCounters();
      checkStudentStatus();
      if (state.view === 'adminDashboard') {
        fetchAdminOverview();
        if (state.adminTab === 'auditLogs') fetchAuditLogs();
      }
    });
  } catch (e) {
    updateLiveStatus(false);
  }
}

window.addEventListener('DOMContentLoaded', async () => {

  const exportBtn = $('btnExportCSV');
  if (exportBtn) {
    exportBtn.href = getApiUrl('/api/admin/export-serves.csv');
  }

  const livePill = document.querySelector('.live-status-pill');
  if (livePill) {
    livePill.style.cursor = 'pointer';
    livePill.title = 'Click to inspect or change Backend API URL';
    livePill.addEventListener('click', () => {
      const current = (window.MEALSYNC_CONFIG && window.MEALSYNC_CONFIG.API_BASE_URL) || window.location.origin;
      const input = prompt(`MealSync Backend API URL:\nCurrent target: ${current}\n\nEnter new Backend URL (or leave empty to reset to default):`, current);
      if (input !== null && window.MEALSYNC_CONFIG) {
        window.MEALSYNC_CONFIG.setApiBaseUrl(input.trim());
      }
    });
  }

  registerServiceWorker();
  initSession();
  await probeBackend();
  await fetchAnnouncement();
  await fetchCounters();
  await fetchSchedules();
  await checkStudentStatus();
  setupSSE();
  setInterval(() => {
    probeBackend();
    fetchCounters();
    checkStudentStatus();
  }, 6000);
});

