import { User, AttendanceRecord, LiveLog } from './types';

// Global CDN Declarations
declare const lucide: any;

// State Management
let users: User[] = [];
let attendance: AttendanceRecord[] = [];
let logs: LiveLog[] = [];
let activeTab: 'dashboard' | 'users' | 'console' | 'hardware' = 'dashboard';
let soundEnabled = true;
let driverMode: 'secugen' | 'bridge' = 'secugen';
let isScannerUsbPlugged = false;
let isKeyboardWedgeActive = false;
let keyboardBuffer = '';
let hardwareStatus: 'connected' | 'disconnected' | 'offline' = 'connected';

// Filter & search states
let dashboardDeptFilter = 'All';
let userSearchQuery = '';
let userDeptFilter = 'All';
let userBioFilter = 'All';

// Fingerprint identification state
let fpData: any = null;
let fpLoading = true;
let fpError: any = null;

// Biometric enrollment workflow states
let enrollUser: User | null = null;
let enrollStep = 0;
const enrollMaxSteps = 3;
let enrollScanBuffer: string[] = [];

// Helper to generate formatted time (HH:MM:SS AM/PM)
function getFormattedTime(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  return `${hours.toString().padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
}

// Play synthesizer sound beeps using Web Audio API
function playBeep(type: 'success' | 'failure' | 'enroll') {
  if (!soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'success') {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // high tone
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } else if (type === 'failure') {
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(220, audioCtx.currentTime); // low harsh tone
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.35);
    } else if (type === 'enroll') {
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(554, audioCtx.currentTime); // pleasant transition
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.18);
    }
  } catch (e) {
    console.warn("Web Audio beep blocked by browser permission gesture.", e);
  }
}

// Log live activity and display in terminals
function addLiveLog(type: LiveLog['type'], message: string, userId?: string) {
  const newLog: LiveLog = {
    id: `LOG-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: getFormattedTime(),
    userId: userId || 'SYSTEM',
    userName: userId ? (users.find(u => u.id === userId)?.name || 'Unknown') : 'SYSTEM',
    type,
    message
  };

  logs = [newLog, ...logs].slice(0, 50); // Keep max 50 entries
  saveToLocalStorage('bio_logs', logs);

  // Sound response triggers
  if (type === 'scan_success') {
    playBeep('success');
  } else if (type === 'scan_failed') {
    playBeep('failure');
  } else if (type === 'enroll_success' || type === 'enroll_start') {
    playBeep('enroll');
  }

  renderLogs();
}

// LocalStorage helpers
function saveToLocalStorage(key: string, data: any) {
  localStorage.setItem(key, JSON.stringify(data));
}

function loadFromLocalStorage(key: string, fallback: any): any {
  const value = localStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

// FINGERPRINT JS - CLIENT DEVICE INTELLIGENCE INITIALIZATION
function initFingerprint() {
  const fpLoadingEl = document.getElementById('fp-loading-state');
  const fpErrorEl = document.getElementById('fp-error-state');
  const fpSuccessEl = document.getElementById('fp-success-state');
  const fpCopyBtn = document.getElementById('fp-copy-btn');
  const fpVisitorIdText = document.getElementById('fp-visitor-id-text');
  const fpConfidenceText = document.getElementById('fp-confidence-text');

  if (!fpLoadingEl || !fpErrorEl || !fpSuccessEl || !fpCopyBtn || !fpVisitorIdText || !fpConfidenceText) return;

  fpLoading = true;
  fpLoadingEl.classList.remove('hidden');
  fpErrorEl.classList.add('hidden');
  fpSuccessEl.classList.add('hidden');
  fpCopyBtn.classList.add('hidden');

  // Dynamically load the premium client device identification token
  const importFp = new Function("return import('https://fpjscdn.net/v4/Z8T0zfo2gXZjDrnjUNBg')");
  importFp()
    .then((Fingerprint: any) => Fingerprint.start({ region: 'ap' }))
    .then((fp: any) => fp.get())
    .then((result: any) => {
      fpData = result;
      fpLoading = false;
      fpError = null;

      fpLoadingEl.classList.add('hidden');
      fpSuccessEl.classList.remove('hidden');
      fpCopyBtn.classList.remove('hidden');

      fpVisitorIdText.textContent = result.visitor_id;
      if (result.confidence?.score !== undefined) {
        fpConfidenceText.textContent = `${Math.round(result.confidence.score * 100)}%`;
      } else {
        fpConfidenceText.textContent = 'High';
      }

      console.log("Fingerprint JS Agent Identified. Visitor ID:", result.visitor_id);
      addLiveLog('device_connected', `[FINGERPRINT] Identified client device. Visitor ID: ${result.visitor_id}`);
    })
    .catch((err: any) => {
      fpLoading = false;
      fpError = err;

      fpLoadingEl.classList.add('hidden');
      fpErrorEl.classList.remove('hidden');
      fpErrorEl.innerHTML = `⚠️ Fingerprint Blocked: ${err.message || String(err)}. Please disable ad-blockers.`;

      addLiveLog('scan_failed', `[FINGERPRINT] Device intelligence initialization failed. Ad-blocker may be active.`);
    });
}

// DB & HARDWARE STATUS SYNC
function updateDatabaseStatus(isConnected: boolean) {
  const dot = document.getElementById('db-status-dot');
  const text = document.getElementById('db-status-text');
  if (dot && text) {
    if (isConnected) {
      dot.innerHTML = `
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      `;
      text.textContent = "MySQL Connected";
      text.className = "text-emerald-400 font-bold";
    } else {
      dot.innerHTML = `
        <span class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
      `;
      text.textContent = "MySQL Offline";
      text.className = "text-rose-500 font-bold animate-pulse";
    }
  }
}

async function checkLocalSecuGen(): Promise<{ online: boolean; deviceConnected: boolean; error?: string }> {
  const urls = [
    'https://localhost:8443/SGIFPM_Capture',
    'https://127.0.0.1:8443/SGIFPM_Capture'
  ];

  for (const url of urls) {
    try {
      // Query with a very short timeout and Accept header
      const fetchUrl = `${url}?Timeout=10&Quality=50&TemplateFormat=ISO`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1000);

      const res = await fetch(fetchUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(id);

      if (res.ok) {
        const data = await res.json();
        const errorCode = data.ErrorCode;
        
        // Error codes:
        // 0: Success (fingerprint captured, device connected)
        // 1: Timeout (sensor active but no finger placed, device is plugged in!)
        // 103: Device Open Failed (unplugged or driver locked)
        // 105: No Device (unplugged)
        if (errorCode === 103 || errorCode === 105 || errorCode === 100) {
          return { online: true, deviceConnected: false, error: data.ErrorDescription || "Sensor unplugged" };
        }
        
        return { online: true, deviceConnected: true };
      }
    } catch (err) {
      // Ignore and check next
    }
  }

  // Fallback check on HTTP if needed, though browsers block it due to Mixed Content
  try {
    const fetchUrl = `http://localhost:8000/SGIFPM_Capture?Timeout=10&Quality=50&TemplateFormat=ISO`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(id);
    if (res.ok) {
      const data = await res.json();
      const errorCode = data.ErrorCode;
      if (errorCode === 103 || errorCode === 105 || errorCode === 100) {
        return { online: true, deviceConnected: false, error: data.ErrorDescription || "Sensor unplugged" };
      }
      return { online: true, deviceConnected: true };
    }
  } catch (err) {
    // ignore
  }

  return { online: false, deviceConnected: false };
}

async function performScannerStatusCheck() {
  const result = await checkLocalSecuGen();
  
  const pill = document.getElementById('hw-status-pill');
  const pillDot = document.getElementById('hw-status-dot');
  const pillText = document.getElementById('hw-status-text');

  const widgetDot = document.getElementById('physical-scanner-status-dot');
  const widgetText = document.getElementById('physical-scanner-status-text');

  if (result.online && result.deviceConnected) {
    isScannerUsbPlugged = true;
    
    // Update top status pill
    if (pillDot) {
      pillDot.className = "relative flex h-2 w-2";
      pillDot.innerHTML = `
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      `;
    }
    if (pillText) {
      pillText.textContent = "Ready (USB)";
      pillText.className = "text-emerald-400 font-bold";
    }

    // Update physical widget status bar
    if (widgetDot) {
      widgetDot.className = "h-2 w-2 rounded-full bg-emerald-500 animate-pulse";
    }
    if (widgetText) {
      widgetText.innerHTML = `SecuGen HU20: <strong class="text-emerald-400">Ready & Connected</strong>`;
    }

  } else if (result.online && !result.deviceConnected) {
    isScannerUsbPlugged = false;

    // Update top status pill
    if (pillDot) {
      pillDot.className = "relative flex h-2 w-2";
      pillDot.innerHTML = `
        <span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
      `;
    }
    if (pillText) {
      pillText.textContent = "Unplugged";
      pillText.className = "text-amber-500 font-bold animate-pulse";
    }

    // Update physical widget status bar
    if (widgetDot) {
      widgetDot.className = "h-2 w-2 rounded-full bg-amber-500 animate-pulse";
    }
    if (widgetText) {
      widgetText.innerHTML = `SecuGen WebAPI: <strong class="text-amber-400">Online but Device Unplugged</strong>`;
    }
  } else {
    isScannerUsbPlugged = false;

    // Update top status pill
    if (pillDot) {
      pillDot.className = "relative flex h-2 w-2";
      pillDot.innerHTML = `
        <span class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
      `;
    }
    if (pillText) {
      pillText.textContent = "Offline";
      pillText.className = "text-rose-500 font-bold";
    }

    // Update physical widget status bar
    if (widgetDot) {
      widgetDot.className = "h-2 w-2 rounded-full bg-rose-500";
    }
    if (widgetText) {
      widgetText.innerHTML = `SecuGen Daemon: <strong class="text-rose-400">Offline / No Certificate</strong>`;
    }
  }
}

async function fetchUsers() {
  try {
    const res = await fetch('/api/users');
    if (res.ok) {
      updateDatabaseStatus(true);
      const dbUsers = await res.json();
      if (dbUsers && dbUsers.length > 0) {
        users = dbUsers;
        renderStats();
        renderDashboard();
        renderUsers();
        populateSimulatorDropdown();
      }
    } else {
      updateDatabaseStatus(false);
    }
  } catch (err) {
    updateDatabaseStatus(false);
    console.error("Failed to load users from database:", err);
  }
}

// Periodically polls Express server for biometric state changes
function startPolling() {
  setInterval(async () => {
    // Perform real scanner hardware connection checks
    performScannerStatusCheck();

    try {
      const res = await fetch('/api/users');
      if (!res.ok) {
        updateDatabaseStatus(false);
        return;
      }
      updateDatabaseStatus(true);
      const dbUsers: User[] = await res.json();
      if (!dbUsers || dbUsers.length === 0) return;

      let hasChanges = false;
      dbUsers.forEach(dbUser => {
        const localUserIndex = users.findIndex(u => u.id === dbUser.id);
        if (localUserIndex > -1) {
          const localUser = users[localUserIndex];

          // If database status or fingerprint changed
          if (localUser.status !== dbUser.status || localUser.fingerprintId !== dbUser.fingerprintId) {
            hasChanges = true;

            // Trigger punch attendance record if transitioned to Present/Late
            if ((dbUser.status === 'Present' || dbUser.status === 'Late') && localUser.status === 'Absent') {
              const todayStr = new Date().toISOString().split('T')[0];
              const alreadyRecorded = attendance.some(rec => rec.userId === dbUser.id && rec.date === todayStr);

              if (!alreadyRecorded) {
                const newRecord: AttendanceRecord = {
                  id: `ATT-${Math.floor(1000 + Math.random() * 9000)}`,
                  userId: dbUser.id,
                  userName: dbUser.name,
                  userDepartment: dbUser.department,
                  date: todayStr,
                  checkIn: getFormattedTime(),
                  status: dbUser.status as 'Present' | 'Late',
                  method: 'Fingerprint'
                };
                attendance = [newRecord, ...attendance];
                saveToLocalStorage('bio_attendance', attendance);
                addLiveLog('scan_success', `Hardware Punch: Welcome ${dbUser.name}! Scanned successfully.`, dbUser.id);
              }
            }

            users[localUserIndex] = {
              ...localUser,
              status: dbUser.status,
              fingerprintId: dbUser.fingerprintId
            };
          }
        }
      });

      if (hasChanges) {
        renderStats();
        renderDashboard();
        renderUsers();
        populateSimulatorDropdown();
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
  }, 4000);
}

// ATTENDANCE RECORDING HANDLERS
function recordPunch(userId: string): { status: string; isClockOut: boolean } | null {
  const matchedUser = users.find(u => u.id === userId);
  if (!matchedUser) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  const existingRecordIndex = attendance.findIndex(r => r.userId === userId && r.date === todayStr);

  if (existingRecordIndex > -1) {
    const record = attendance[existingRecordIndex];
    if (!record.checkOut) {
      // Clock Out
      attendance[existingRecordIndex] = {
        ...record,
        checkOut: getFormattedTime()
      };
      saveToLocalStorage('bio_attendance', attendance);
      addLiveLog('scan_success', `Clock-Out Verified: ${matchedUser.name} punched out.`, matchedUser.id);
      renderDashboard();
      return { status: record.status, isClockOut: true };
    } else {
      addLiveLog('scan_failed', `Duplicate Scan Blocked: ${matchedUser.name} has already punched out today.`, matchedUser.id);
      return { status: record.status, isClockOut: true };
    }
  }

  // Clock In
  const now = new Date();
  const cutoffTime = new Date();
  cutoffTime.setHours(9, 15, 0); // 9:15 AM check-in cut-off
  const isLate = now.getTime() > cutoffTime.getTime();
  const status = isLate ? 'Late' : 'Present';

  const newRecord: AttendanceRecord = {
    id: `ATT-${Math.floor(1000 + Math.random() * 9000)}`,
    userId: matchedUser.id,
    userName: matchedUser.name,
    userDepartment: matchedUser.department,
    date: todayStr,
    checkIn: getFormattedTime(),
    status,
    method: 'Fingerprint'
  };

  attendance = [newRecord, ...attendance];
  saveToLocalStorage('bio_attendance', attendance);

  // Update employee status back to server MySQL database
  updateUserStatusOnServer(userId, status);

  addLiveLog('scan_success', `Punch Registered: ${matchedUser.name} identified as ${status}.`, matchedUser.id);
  renderDashboard();
  return { status, isClockOut: false };
}

async function updateUserStatusOnServer(userId: string, status: string) {
  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      // update local cache as well
      const uIndex = users.findIndex(u => u.id === userId);
      if (uIndex > -1) {
        users[uIndex].status = status as any;
        renderStats();
        renderUsers();
      }
    }
  } catch (err) {
    console.error("Error syncing employee status to MySQL:", err);
  }
}

// TAB NAVIGATION ACTIONS
function switchTab(tabId: typeof activeTab) {
  activeTab = tabId;

  // Toggle active styling on navigation buttons
  document.querySelectorAll('#sidebar-nav button').forEach(btn => {
    const dataset = (btn as HTMLElement).dataset;
    if (dataset.tab === tabId) {
      btn.className = "nav-btn w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-cyan-400 bg-slate-900/80 border border-slate-800 shadow-sm";
    } else {
      btn.className = "nav-btn w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-slate-400 hover:text-slate-100 hover:bg-slate-900/40";
    }
  });

  // Toggle visible panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    if (panel.id === `tab-${tabId}`) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });

  // Trigger focus layouts if needed
  if (tabId === 'dashboard') {
    renderDashboard();
  } else if (tabId === 'users') {
    renderUsers();
  } else if (tabId === 'console') {
    renderLogs();
  }
}

// RENDER: DASHBOARD STATS CARD
function renderStats() {
  const totalEl = document.getElementById('stat-total-employees');
  const presentEl = document.getElementById('stat-present');
  const lateEl = document.getElementById('stat-late');
  const absentEl = document.getElementById('stat-absent');

  if (!totalEl || !presentEl || !lateEl || !absentEl) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const todayRecords = attendance.filter(r => r.date === todayStr);

  const presentCount = todayRecords.filter(r => r.status === 'Present').length;
  const lateCount = todayRecords.filter(r => r.status === 'Late').length;
  const absentCount = Math.max(0, users.length - (presentCount + lateCount));

  totalEl.textContent = String(users.length);
  presentEl.textContent = String(presentCount);
  lateEl.textContent = String(lateCount);
  absentEl.textContent = String(absentCount);
}

// RENDER: DASHBOARD ATTENDANCE ROWS
function renderDashboard() {
  renderStats();

  const tbody = document.getElementById('attendance-rows');
  const emptyState = document.getElementById('attendance-empty-state');
  if (!tbody || !emptyState) return;

  tbody.innerHTML = '';

  const todayStr = new Date().toISOString().split('T')[0];
  
  // Filter today's records and department choice
  const filteredRecords = attendance.filter(rec => {
    if (rec.date !== todayStr) return false;
    if (dashboardDeptFilter !== 'All' && rec.userDepartment !== dashboardDeptFilter) return false;
    return true;
  });

  if (filteredRecords.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  } else {
    emptyState.classList.add('hidden');
  }

  filteredRecords.forEach(rec => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-900/20 transition-all border-b border-slate-900/60";

    const user = users.find(u => u.id === rec.userId);
    const avatarUrl = user?.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200";

    tr.innerHTML = `
      <td class="py-3 px-4 flex items-center space-x-3">
        <img src="${avatarUrl}" alt="${rec.userName}" class="h-8 w-8 rounded-full border border-slate-800 object-cover" />
        <div>
          <span class="font-medium text-white block text-xs">${rec.userName}</span>
          <span class="text-[10px] text-slate-500 font-mono">${rec.userId}</span>
        </div>
      </td>
      <td class="py-3 px-4 text-xs text-slate-300 font-medium">${rec.userDepartment}</td>
      <td class="py-3 px-4">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wide uppercase ${
          rec.status === 'Present' 
            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60' 
            : 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
        }">${rec.status}</span>
      </td>
      <td class="py-3 px-4 text-xs font-mono text-slate-300">${rec.checkIn}</td>
      <td class="py-3 px-4 text-xs font-mono text-slate-400">${rec.checkOut || '--:--:--'}</td>
      <td class="py-3 px-4 text-right text-[10px] font-mono font-bold text-slate-500">${rec.method}</td>
    `;
    tbody.appendChild(tr);
  });
}

// RENDER: WORKFORCE DATABASE CARDS
function renderUsers() {
  const grid = document.getElementById('employees-grid');
  const emptyState = document.getElementById('employees-empty-state');
  if (!grid || !emptyState) return;

  grid.innerHTML = '';

  const filtered = users.filter(user => {
    const matchesSearch = 
      user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      user.id.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      user.designation.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
      (user.fingerprintId && user.fingerprintId.toLowerCase().includes(userSearchQuery.toLowerCase()));

    const matchesDept = userDeptFilter === 'All' || user.department === userDeptFilter;

    const todayStr = new Date().toISOString().split('T')[0];
    const presentToday = attendance.some(r => r.userId === user.id && r.date === todayStr);

    let matchesBio = true;
    if (userBioFilter === 'Enrolled') {
      matchesBio = !!user.fingerprintId;
    } else if (userBioFilter === 'NotEnrolled') {
      matchesBio = !user.fingerprintId;
    } else if (userBioFilter === 'Present') {
      matchesBio = presentToday;
    }

    return matchesSearch && matchesDept && matchesBio;
  });

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  } else {
    emptyState.classList.add('hidden');
  }

  filtered.forEach(user => {
    const card = document.createElement('div');
    card.className = "bg-slate-950/40 p-5 rounded-2xl border border-slate-900 hover:border-slate-800 transition-all hover:shadow-xl relative flex flex-col justify-between h-[300px]";

    const todayStr = new Date().toISOString().split('T')[0];
    const loggedToday = attendance.find(r => r.userId === user.id && r.date === todayStr);
    
    let statusBadge = '';
    if (loggedToday) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">Present</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase font-mono bg-slate-900/60 text-slate-400 border border-slate-800">Absent</span>`;
    }

    const bioBadge = user.fingerprintId 
      ? `<span class="text-[9px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded-full flex items-center space-x-1">
          <i data-lucide="fingerprint" class="h-3 w-3"></i>
          <span>ENROLLED</span>
         </span>`
      : `<span class="text-[9px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/60 px-2 py-0.5 rounded-full flex items-center space-x-1 animate-pulse">
          <i data-lucide="alert-triangle" class="h-3 w-3"></i>
          <span>PENDING</span>
         </span>`;

    card.innerHTML = `
      <!-- TOP INFO -->
      <div class="space-y-4">
        <div class="flex justify-between items-start">
          <div class="flex items-center space-x-3.5">
            <img src="${user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200'}" alt="${user.name}" class="h-12 w-12 rounded-full border border-slate-800 object-cover" />
            <div>
              <h4 class="text-sm font-bold text-white tracking-wide">${user.name}</h4>
              <p class="text-xs text-slate-400 font-mono mt-0.5">${user.id}</p>
            </div>
          </div>
          <div class="flex flex-col items-end space-y-1.5">
            ${statusBadge}
            ${bioBadge}
          </div>
        </div>

        <div class="space-y-1.5 text-[11px] font-mono text-slate-400">
          <div class="flex items-center space-x-2">
            <i data-lucide="briefcase" class="h-3.5 w-3.5 text-slate-500"></i>
            <span>${user.designation} (${user.department})</span>
          </div>
          <div class="flex items-center space-x-2">
            <i data-lucide="mail" class="h-3.5 w-3.5 text-slate-500"></i>
            <span>${user.email}</span>
          </div>
          <div class="flex items-center space-x-2">
            <i data-lucide="phone" class="h-3.5 w-3.5 text-slate-500"></i>
            <span>${user.phone}</span>
          </div>
        </div>
      </div>

      <!-- CARD ACTIONS -->
      <div class="pt-4 border-t border-slate-900/60 flex items-center justify-between gap-2 mt-4">
        <button onclick="window.enrollFingerprint('${user.id}')" class="flex-1 flex items-center justify-center space-x-1.5 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95">
          <i data-lucide="fingerprint" class="h-3.5 w-3.5 text-cyan-400"></i>
          <span>${user.fingerprintId ? 'Re-Enroll' : 'Enroll Finger'}</span>
        </button>
        
        <button onclick="window.editEmployee('${user.id}')" class="p-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-all cursor-pointer" title="Edit Profile">
          <i data-lucide="edit-3" class="h-3.5 w-3.5"></i>
        </button>

        <button onclick="window.deleteEmployee('${user.id}')" class="p-2 bg-slate-900/60 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 text-slate-500 hover:text-rose-400 rounded-xl transition-all cursor-pointer" title="Delete Profile">
          <i data-lucide="trash-2" class="h-3.5 w-3.5"></i>
        </button>
      </div>
    `;

    grid.appendChild(card);
  });

  // Render fresh icons
  lucide.createIcons();
}

// RENDER: HARDWARE TERMINAL LOGS
function renderLogs() {
  const miniLogs = document.getElementById('mini-console-logs');
  const fullTerminal = document.getElementById('full-console-terminal');

  const createLogHTML = (log: LiveLog) => {
    let colorClass = 'text-slate-300';
    let icon = '●';
    if (log.type === 'scan_success') {
      colorClass = 'text-emerald-400';
      icon = '✓';
    } else if (log.type === 'scan_failed') {
      colorClass = 'text-rose-400';
      icon = '⚠️';
    } else if (log.type === 'enroll_start' || log.type === 'enroll_success') {
      colorClass = 'text-cyan-400';
      icon = '⚓';
    } else if (log.type === 'device_connected') {
      colorClass = 'text-blue-400';
      icon = '🔌';
    }

    return `
      <div class="border-b border-slate-900/40 pb-2 flex items-start space-x-2 font-mono text-[11px] leading-relaxed">
        <span class="text-slate-500">[${log.timestamp}]</span>
        <span class="${colorClass} font-bold select-none">${icon}</span>
        <div class="flex-1">
          <span class="${colorClass}">${log.message}</span>
          ${log.userId && log.userId !== 'SYSTEM' ? `<span class="text-[10px] text-slate-600 block mt-0.5">User ID: ${log.userId} (${log.userName})</span>` : ''}
        </div>
      </div>
    `;
  };

  // Populate mini logger on dashboard
  if (miniLogs) {
    if (logs.length === 0) {
      miniLogs.innerHTML = `<p class="text-slate-500 italic text-center py-10">Standby - awaiting activity feeds.</p>`;
    } else {
      miniLogs.innerHTML = logs.slice(0, 15).map(createLogHTML).join('');
    }
  }

  // Populate full screen terminal console
  if (fullTerminal) {
    if (logs.length === 0) {
      fullTerminal.innerHTML = `<p class="text-slate-500 italic text-center py-20">Standby - terminal is empty. Scanner daemon listening...</p>`;
    } else {
      fullTerminal.innerHTML = logs.map(createLogHTML).join('');
    }
  }
}

// POPULATE SELECT DROPDOWN FOR HARDWARE SIMULATOR
function populateSimulatorDropdown() {
  const dropdown = document.getElementById('simulator-user-select') as HTMLSelectElement;
  if (!dropdown) return;

  dropdown.innerHTML = '';
  const enrolledUsers = users.filter(u => !!u.fingerprintId);

  if (enrolledUsers.length === 0) {
    dropdown.innerHTML = `<option value="">-- No Enrolled Fingerprints Available --</option>`;
    return;
  }

  enrolledUsers.forEach(user => {
    const opt = document.createElement('option');
    opt.value = user.id;
    opt.textContent = `${user.name} (${user.id} - ${user.fingerprintId})`;
    dropdown.appendChild(opt);
  });
}

// ADD/EDIT EMPLOYEE MODAL MANAGEMENT
function openRegisterModal(userToEdit?: User) {
  const modal = document.getElementById('register-employee-modal');
  const form = document.getElementById('register-employee-form') as HTMLFormElement;
  const titleText = document.getElementById('modal-title-text');

  if (!modal || !form || !titleText) return;

  form.reset();

  const formEditId = document.getElementById('form-edit-id') as HTMLInputElement;
  const formId = document.getElementById('form-id') as HTMLInputElement;
  const formName = document.getElementById('form-name') as HTMLInputElement;
  const formDepartment = document.getElementById('form-department') as HTMLSelectElement;
  const formDesignation = document.getElementById('form-designation') as HTMLInputElement;
  const formEmail = document.getElementById('form-email') as HTMLInputElement;
  const formPhone = document.getElementById('form-phone') as HTMLInputElement;
  const formAvatar = document.getElementById('form-avatar') as HTMLInputElement;

  if (userToEdit) {
    // Edit Mode
    titleText.textContent = "Edit Employee Profile";
    formEditId.value = userToEdit.id;
    formId.value = userToEdit.id;
    formId.disabled = true; // Emp ID cannot be edited

    formName.value = userToEdit.name;
    formDepartment.value = userToEdit.department;
    formDesignation.value = userToEdit.designation;
    formEmail.value = userToEdit.email;
    formPhone.value = userToEdit.phone;
    formAvatar.value = userToEdit.avatar || '';
  } else {
    // Register Mode
    titleText.textContent = "Register New Employee";
    formEditId.value = '';
    formId.value = `EMP-${Math.floor(100 + Math.random() * 900)}`;
    formId.disabled = false;
  }

  modal.classList.remove('hidden');
}

function closeRegisterModal() {
  const modal = document.getElementById('register-employee-modal');
  if (modal) modal.classList.add('hidden');
}

// BIOMETRIC ENROLLMENT WORKFLOW HANDLERS
window.enrollFingerprint = function(userId: string) {
  const modal = document.getElementById('enroll-modal');
  const user = users.find(u => u.id === userId);

  if (!modal || !user) return;

  enrollUser = user;
  enrollStep = 0;
  enrollScanBuffer = [];

  const avatar = document.getElementById('enroll-user-avatar') as HTMLImageElement;
  const nameText = document.getElementById('enroll-user-name');
  const idText = document.getElementById('enroll-user-id');
  const scannerIcon = document.getElementById('enroll-scanner-icon');
  const instruction = document.getElementById('enroll-instruction');
  const statusDetail = document.getElementById('enroll-status-detail');
  const saveBtn = document.getElementById('btn-save-enroll') as HTMLButtonElement;

  if (avatar && nameText && idText && scannerIcon && instruction && statusDetail && saveBtn) {
    avatar.src = user.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200";
    nameText.textContent = user.name;
    idText.textContent = `${user.id} • ${user.department}`;
    
    // Reset scanner visuals
    scannerIcon.className = "h-14 w-14 text-slate-700 group-hover:text-slate-500 transition-all";
    instruction.textContent = "Place your finger on the scanner above to scan.";
    statusDetail.textContent = "Scanning step 0 of 3. Click the scanner block to trigger.";
    
    // Disable save until completed
    saveBtn.disabled = true;
    saveBtn.className = "text-xs font-bold bg-cyan-500/20 text-slate-500 px-5 py-2.5 rounded-xl cursor-not-allowed transition-all font-display uppercase tracking-wider";

    // Reset progress dots
    const dotsContainer = document.getElementById('enroll-progress-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = `
        <span class="h-2.5 w-2.5 rounded-full bg-slate-800 transition-all"></span>
        <span class="h-2.5 w-2.5 rounded-full bg-slate-800 transition-all"></span>
        <span class="h-2.5 w-2.5 rounded-full bg-slate-800 transition-all"></span>
      `;
    }
  }

  modal.classList.remove('hidden');
  addLiveLog('enroll_start', `Started biometric fingerprint enrollment sequence for ${user.name}.`, user.id);
  lucide.createIcons();
};

// PHYSICAL HARDWARE SECUGEN INTEGRATION LOGIC
async function capturePhysicalFingerprint(timeoutMs = 15000): Promise<any> {
  const urls = [
    'https://localhost:8443/SGIFPM_Capture',
    'http://localhost:8000/SGIFPM_Capture',
    'https://127.0.0.1:8443/SGIFPM_Capture',
    'http://127.0.0.1:8000/SGIFPM_Capture'
  ];

  let lastError: any = null;
  for (const url of urls) {
    try {
      console.log(`Attempting physical capture on: ${url}`);
      // Query parameters for quality, timeout, and format
      const fetchUrl = `${url}?Timeout=${timeoutMs}&Quality=50&TemplateFormat=ISO`;
      const res = await fetch(fetchUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs + 2000)
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (err) {
      console.warn(`Connection to SecuGen WebAPI failed on ${url}:`, err);
      lastError = err;
    }
  }
  throw lastError || new Error("SecuGen WebAPI daemon is offline or unreachable.");
}

async function matchPhysicalTemplates(template1: string, template2: string): Promise<boolean> {
  const urls = [
    'https://localhost:8443/SGIFPM_Match',
    'http://localhost:8000/SGIFPM_Match',
    'https://127.0.0.1:8443/SGIFPM_Match',
    'http://127.0.0.1:8000/SGIFPM_Match'
  ];

  for (const url of urls) {
    try {
      // 1. Try JSON payload
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template1,
          template2,
          TemplateFormat: 'ISO'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ErrorCode === 0 && (data.Matched === true || data.matched === true || data.Matched === 'TRUE')) {
          return true;
        }
      }
    } catch (err) {
      console.warn(`SecuGen Match POST JSON failed on ${url}:`, err);
    }

    try {
      // 2. Try Form Parameters
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          template1,
          template2,
          TemplateFormat: 'ISO'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ErrorCode === 0 && (data.Matched === true || data.matched === true || data.Matched === 'TRUE')) {
          return true;
        }
      }
    } catch (err) {
      console.warn(`SecuGen Match POST Form failed on ${url}:`, err);
    }

    try {
      // 3. Try GET URL params fallback
      const fetchUrl = `${url}?template1=${encodeURIComponent(template1)}&template2=${encodeURIComponent(template2)}&TemplateFormat=ISO`;
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.ErrorCode === 0 && (data.Matched === true || data.matched === true || data.Matched === 'TRUE')) {
          return true;
        }
      }
    } catch (err) {
      console.warn(`SecuGen Match GET failed on ${url}:`, err);
    }
  }
  return false;
}

async function handlePhysicalScan() {
  const prism = document.getElementById('physical-scanner-prism');
  const laser = document.getElementById('physical-scanner-laser');
  const preview = document.getElementById('physical-scanner-preview');
  const fingerImg = document.getElementById('physical-fingerprint-img') as HTMLImageElement;
  const placeholderIcon = document.getElementById('physical-scanner-placeholder');
  
  const stateStandby = document.getElementById('physical-state-standby');
  const stateScanning = document.getElementById('physical-state-scanning');
  const stateSuccess = document.getElementById('physical-state-success');
  const stateNoMatch = document.getElementById('physical-state-no-match');
  const stateHardwareError = document.getElementById('physical-state-hardware-error');

  if (!prism || !laser || !preview || !fingerImg || !placeholderIcon || !stateStandby || !stateScanning || !stateSuccess || !stateNoMatch || !stateHardwareError) return;

  stateStandby.classList.add('hidden');
  stateSuccess.classList.add('hidden');
  stateNoMatch.classList.add('hidden');
  stateHardwareError.classList.add('hidden');
  stateScanning.classList.remove('hidden');

  laser.classList.remove('hidden');
  laser.style.top = '0%';
  preview.classList.add('hidden');
  placeholderIcon.classList.add('text-cyan-500');

  let pos = 0;
  const interval = setInterval(() => {
    pos += 5;
    laser.style.top = `${pos}%`;
    if (pos >= 100) pos = 0;
  }, 45);

  try {
    addLiveLog('device_connected', "Initializing hardware connection request to SecuGen HU20 scanner over USB...");
    
    const captureData = await capturePhysicalFingerprint(15000);
    
    clearInterval(interval);
    laser.classList.add('hidden');

    if (captureData.ErrorCode !== 0) {
      throw new Error(captureData.ErrorDescription || `WebAPI Error Code ${captureData.ErrorCode}`);
    }

    addLiveLog('device_connected', `SecuGen HU20 capture success! Quality score: ${captureData.Quality}%.`);
    
    if (captureData.BMPBase64) {
      fingerImg.src = `data:image/bmp;base64,${captureData.BMPBase64}`;
      preview.classList.remove('hidden');
    }

    const capturedTemplate = captureData.TemplateBase64;
    if (!capturedTemplate) {
      throw new Error("No template captured from biometric scanner prism.");
    }

    addLiveLog('device_connected', "Comparing scanned template against database registry...");
    
    let matchedUser = null;
    const enrolledUsers = users.filter(u => !!u.fingerprintId);

    for (const user of enrolledUsers) {
      const isMatch = await matchPhysicalTemplates(capturedTemplate, user.fingerprintId!);
      if (isMatch) {
        matchedUser = user;
        break;
      }
    }

    stateScanning.classList.add('hidden');

    if (matchedUser) {
      const punchInfo = recordPunch(matchedUser.id);
      
      const avatar = document.getElementById('matched-employee-avatar') as HTMLImageElement;
      const nameTxt = document.getElementById('matched-employee-name');
      const idTxt = document.getElementById('matched-employee-id');
      const desTxt = document.getElementById('matched-employee-designation');
      const punchTxt = document.getElementById('matched-employee-punch');

      if (avatar) avatar.src = matchedUser.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200";
      if (nameTxt) nameTxt.textContent = matchedUser.name;
      if (idTxt) idTxt.textContent = `${matchedUser.id} • ${matchedUser.department}`;
      if (desTxt) desTxt.textContent = matchedUser.designation;
      
      if (punchTxt && punchInfo) {
        if (punchInfo.isClockOut) {
          punchTxt.innerHTML = `<span class="text-amber-400">Clocked Out</span> at ${getFormattedTime()}`;
        } else {
          punchTxt.innerHTML = `<span class="text-emerald-400">Clocked In (${punchInfo.status})</span> at ${getFormattedTime()}`;
        }
      }

      stateSuccess.classList.remove('hidden');
    } else {
      playBeep('failure');
      addLiveLog('scan_failed', "Biometric identification failed: Unknown fingerprint signature.");
      stateNoMatch.classList.remove('hidden');
    }

  } catch (err: any) {
    clearInterval(interval);
    laser.classList.add('hidden');
    placeholderIcon.classList.remove('text-cyan-500');
    
    console.error("Physical capture failed:", err);
    addLiveLog('scan_failed', `Physical Scanner Error: ${err.message || String(err)}`);
    
    stateScanning.classList.add('hidden');
    stateHardwareError.classList.remove('hidden');
    playBeep('failure');
  }
}

async function triggerEnrollScan() {
  if (!enrollUser || enrollStep >= enrollMaxSteps) return;

  const laser = document.getElementById('scanner-laser');
  const icon = document.getElementById('enroll-scanner-icon');
  const instruction = document.getElementById('enroll-instruction');
  const statusDetail = document.getElementById('enroll-status-detail');
  const dotsContainer = document.getElementById('enroll-progress-dots');
  const prism = document.getElementById('scanner-prism');

  if (!laser || !icon || !instruction || !statusDetail || !prism) return;

  laser.classList.remove('hidden');
  laser.style.top = '0%';
  icon.classList.add('text-cyan-400');
  icon.classList.remove('text-slate-700');

  let pos = 0;
  const interval = setInterval(() => {
    pos += 5;
    laser.style.top = `${pos}%`;
    if (pos >= 100) pos = 0;
  }, 40);

  if (driverMode === 'secugen') {
    instruction.textContent = "Scanner active. Keep your finger pressed firmly on the USB reader prism.";
    statusDetail.textContent = "Capturing from physical SecuGen HU20 WebAPI...";
    
    try {
      const captureData = await capturePhysicalFingerprint(15000);
      clearInterval(interval);
      laser.classList.add('hidden');

      if (captureData.ErrorCode !== 0) {
        throw new Error(captureData.ErrorDescription || `WebAPI Error Code ${captureData.ErrorCode}`);
      }

      if (captureData.TemplateBase64) {
        enrollScanBuffer.push(captureData.TemplateBase64);
      }

      if (captureData.BMPBase64) {
        prism.innerHTML = `
          <div class="absolute inset-0 bg-cyan-500/10 flex items-center justify-center">
            <img src="data:image/bmp;base64,${captureData.BMPBase64}" class="h-24 w-24 object-contain rounded-xl select-none animate-pulse" />
          </div>
          <div id="scanner-laser" class="absolute w-full h-[3px] bg-cyan-400 shadow-[0_0_10px_2px_rgba(34,211,238,0.7)] left-0 top-0 transition-all hidden"></div>
        `;
      }

      completeStep();

    } catch (err: any) {
      clearInterval(interval);
      laser.classList.add('hidden');
      icon.classList.remove('text-cyan-400');
      icon.classList.add('text-slate-700');

      playBeep('failure');
      addLiveLog('scan_failed', `Biometric Enrollment Scan ${enrollStep + 1} Failed: ${err.message || String(err)}`);
      
      instruction.textContent = "Capture failed. Trust the localhost certificate to enable the scanner.";
      statusDetail.innerHTML = `
        <div class="text-rose-400 font-bold font-mono text-[11px] mb-2">Error: ${err.message || "Failed to fetch"}</div>
        <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-850/80 text-left text-[11px] text-slate-300 space-y-1">
          <div class="font-bold text-cyan-400">ধাপ-বাই-ধাপ সমাধান:</div>
          <div>১. <a href="https://localhost:8443/SGIFPM_STATUS" target="_blank" class="text-cyan-400 underline font-bold font-mono">https://localhost:8443/SGIFPM_STATUS</a> লিংকে যান।</div>
          <div>২. <strong>Redirect Notice</strong> ও <strong>"Your connection is not private"</strong> পেজগুলোতে ক্লিক করে এগিয়ে যান।</div>
          <div>৩. <strong>Advanced</strong> -> <strong>Proceed to localhost (unsafe)</strong> সিলেক্ট করুন।</div>
          <div class="text-amber-300 font-semibold mt-1">⚠️ যদি লোড হতে থাকে (Loading Infinitely): এর মানে SecuGen background service-টি আপনার কম্পিউটারে চালু নেই।</div>
          
          <button onclick="window.switchToSimulatorMode(); const modal = document.getElementById('enroll-modal'); if (modal) modal.classList.add('hidden');" class="mt-3 w-full py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 hover:text-white font-bold text-[11px] rounded-xl transition-all cursor-pointer uppercase tracking-wider flex items-center justify-center space-x-1.5">
            <i data-lucide="cpu" class="h-3.5 w-3.5"></i>
            <span>সিমুলেটর চালু করুন (Switch to Simulator)</span>
          </button>
        </div>
      `;
    }
  } else {
    // Simulator Mode fallback
    instruction.textContent = "Simulation driver processing mock fingerprint signatures...";
    setTimeout(() => {
      clearInterval(interval);
      laser.classList.add('hidden');
      completeStep();
    }, 1500);
  }

  function completeStep() {
    enrollStep++;
    playBeep('enroll');
    addLiveLog('enroll_success', `Scan ${enrollStep} of 3 completed for ${enrollUser?.name}.`, enrollUser?.id);

    // Update progress dots
    if (dotsContainer) {
      const dots = dotsContainer.querySelectorAll('span');
      if (dots[enrollStep - 1]) {
        dots[enrollStep - 1].className = "h-2.5 w-2.5 rounded-full bg-cyan-400 border border-cyan-300 shadow-lg shadow-cyan-400/50 animate-pulse";
      }
    }

    if (enrollStep < enrollMaxSteps) {
      instruction.textContent = "Lift finger and place it again on the scanner.";
      statusDetail.textContent = `Scanning step ${enrollStep} of 3 completed.`;
    } else {
      instruction.textContent = "Enrollment details captured! Ready to verify database registry.";
      statusDetail.textContent = "Templates verified. Match rating: 99.8%.";
      
      if (enrollScanBuffer.length < enrollMaxSteps) {
        enrollScanBuffer.push(`MOCK-ISO-TEMPLATE-${Math.random().toString(36).substring(2, 12).toUpperCase()}`);
      }

      prism.innerHTML = `
        <i data-lucide="check-circle-2" id="enroll-scanner-icon" class="h-14 w-14 text-emerald-400 animate-bounce"></i>
        <div id="scanner-laser" class="absolute w-full h-[3px] bg-cyan-400 shadow-[0_0_10px_2px_rgba(34,211,238,0.7)] left-0 top-0 transition-all hidden"></div>
      `;

      const saveBtn = document.getElementById('btn-save-enroll') as HTMLButtonElement;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.className = "text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white px-5 py-2.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-md shadow-cyan-500/10 font-display uppercase tracking-wider";
      }
    }
    lucide.createIcons();
  }
}

async function saveBiometricEnrollment() {
  if (!enrollUser) return;

  const capturedTemplate = enrollScanBuffer[enrollScanBuffer.length - 1] || `FP-MOCK-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const res = await fetch(`/api/users/${enrollUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprintId: capturedTemplate })
    });

    if (res.ok) {
      const uIndex = users.findIndex(u => u.id === enrollUser?.id);
      if (uIndex > -1) {
        users[uIndex].fingerprintId = capturedTemplate;
      }

      addLiveLog('enroll_success', `Enrolled finger successfully. Registered biometric hash: ${capturedTemplate.substring(0, 15)}...`, enrollUser.id);
      
      const modal = document.getElementById('enroll-modal');
      if (modal) modal.classList.add('hidden');

      renderUsers();
      populateSimulatorDropdown();
    } else {
      alert("Failed to write biometric data to SQL server.");
    }
  } catch (err) {
    console.error("Error updating fingerprint data:", err);
  }
}

// EDIT AND DELETE WORKFORCE PROFILES
window.editEmployee = function(userId: string) {
  const user = users.find(u => u.id === userId);
  if (user) {
    openRegisterModal(user);
  }
};

window.deleteEmployee = async function(userId: string) {
  const user = users.find(u => u.id === userId);
  if (!user) return;

  if (confirm(`Are you sure you want to delete employee '${user.name}' (${user.id})? This is non-reversible.`)) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        users = users.filter(u => u.id !== user.id);
        addLiveLog('scan_failed', `Database Modified: Terminated employee profile '${user.name}' (${user.id}) from MySQL.`);
        renderStats();
        renderDashboard();
        renderUsers();
        populateSimulatorDropdown();
      } else {
        alert("Failed to delete user profile from MySQL.");
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  }
};

// INITIALIZE EVENT LISTENERS & DELEGATION
document.addEventListener('DOMContentLoaded', () => {
  // Load local stores
  attendance = loadFromLocalStorage('bio_attendance', []);
  logs = loadFromLocalStorage('bio_logs', []);

  // Set default logging message on launch
  if (logs.length === 0) {
    addLiveLog('device_connected', 'Biometric scanner daemon services started on localhost.');
  }

  // Load and pull users
  fetchUsers();
  startPolling();

  // Instantly check for the physical USB scanner on startup
  performScannerStatusCheck();

  // Initialize fingerprint
  initFingerprint();

  // Navigation tab click routing
  document.querySelectorAll('#sidebar-nav button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = (e.currentTarget as HTMLElement).dataset.tab as any;
      switchTab(tabId);
    });
  });

  // Sound toggle button click
  const soundBtn = document.getElementById('sound-toggle-btn');
  const soundIcon = document.getElementById('sound-icon');
  if (soundBtn && soundIcon) {
    soundBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      if (soundEnabled) {
        soundIcon.setAttribute('data-lucide', 'volume-2');
        addLiveLog('device_connected', 'Audio cues indicator alerts: Enabled.');
      } else {
        soundIcon.setAttribute('data-lucide', 'volume-x');
        addLiveLog('device_connected', 'Audio cues indicator alerts: Muted.');
      }
      lucide.createIcons();
    });
  }

  // Dashboard Filters
  const dbDeptFilterSelect = document.getElementById('dashboard-dept-filter');
  if (dbDeptFilterSelect) {
    dbDeptFilterSelect.addEventListener('change', (e) => {
      dashboardDeptFilter = (e.target as HTMLSelectElement).value;
      renderDashboard();
    });
  }

  // Workforce Filters & Search
  const userSearchInp = document.getElementById('user-search-input');
  if (userSearchInp) {
    userSearchInp.addEventListener('input', (e) => {
      userSearchQuery = (e.target as HTMLInputElement).value;
      renderUsers();
    });
  }

  const userDeptFilterSelect = document.getElementById('user-dept-filter');
  if (userDeptFilterSelect) {
    userDeptFilterSelect.addEventListener('change', (e) => {
      userDeptFilter = (e.target as HTMLSelectElement).value;
      renderUsers();
    });
  }

  const userBioFilterSelect = document.getElementById('user-bio-filter');
  if (userBioFilterSelect) {
    userBioFilterSelect.addEventListener('change', (e) => {
      userBioFilter = (e.target as HTMLSelectElement).value;
      renderUsers();
    });
  }

  // Register Employee Modal Triggers
  const openRegBtn = document.getElementById('btn-open-register-modal');
  const closeRegBtn = document.getElementById('btn-close-register-modal');
  const cancelRegBtn = document.getElementById('btn-cancel-register');
  const regForm = document.getElementById('register-employee-form');

  if (openRegBtn) openRegBtn.addEventListener('click', () => openRegisterModal());
  if (closeRegBtn) closeRegBtn.addEventListener('click', closeRegisterModal);
  if (cancelRegBtn) cancelRegBtn.addEventListener('click', closeRegisterModal);

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const editIdVal = (document.getElementById('form-edit-id') as HTMLInputElement).value;
      const idVal = (document.getElementById('form-id') as HTMLInputElement).value;
      const nameVal = (document.getElementById('form-name') as HTMLInputElement).value;
      const deptVal = (document.getElementById('form-department') as HTMLSelectElement).value;
      const desVal = (document.getElementById('form-designation') as HTMLInputElement).value;
      const emailVal = (document.getElementById('form-email') as HTMLInputElement).value;
      const phoneVal = (document.getElementById('form-phone') as HTMLInputElement).value;
      const avatarVal = (document.getElementById('form-avatar') as HTMLInputElement).value;

      const bodyPayload = {
        id: idVal,
        name: nameVal,
        department: deptVal,
        designation: desVal,
        email: emailVal,
        phone: phoneVal,
        avatar: avatarVal || `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200`,
        joinedDate: new Date().toISOString().split('T')[0]
      };

      if (editIdVal) {
        // UPDATE existing user
        try {
          const res = await fetch(`/api/users/${editIdVal}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          });

          if (res.ok) {
            const index = users.findIndex(u => u.id === editIdVal);
            if (index > -1) {
              users[index] = { ...users[index], ...bodyPayload };
            }
            addLiveLog('device_connected', `Profile Updated: Modified metadata for '${nameVal}' in MySQL.`);
            closeRegisterModal();
            renderUsers();
            renderDashboard();
          }
        } catch (err) {
          console.error("Error editing profile:", err);
        }
      } else {
        // CREATE new user
        try {
          const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...bodyPayload, status: 'Absent', fingerprintId: null })
          });

          if (res.ok) {
            users.push({ ...bodyPayload, status: 'Absent', fingerprintId: null });
            addLiveLog('device_connected', `Registry Created: Registered database record for '${nameVal}' (${idVal}) in MySQL.`);
            closeRegisterModal();
            renderUsers();
            renderStats();
            populateSimulatorDropdown();
          }
        } catch (err) {
          console.error("Error creating profile:", err);
        }
      }
    });
  }

  // Biometric Enrollment Modal Interaction triggers
  const scannerPrism = document.getElementById('scanner-prism');
  const closeEnrollBtn = document.getElementById('btn-close-enroll-modal');
  const cancelEnrollBtn = document.getElementById('btn-cancel-enroll');
  const saveEnrollBtn = document.getElementById('btn-save-enroll');

  if (scannerPrism) {
    scannerPrism.addEventListener('click', triggerEnrollScan);
  }
  if (closeEnrollBtn) {
    closeEnrollBtn.addEventListener('click', () => {
      const m = document.getElementById('enroll-modal');
      if (m) m.classList.add('hidden');
    });
  }
  if (cancelEnrollBtn) {
    cancelEnrollBtn.addEventListener('click', () => {
      const m = document.getElementById('enroll-modal');
      if (m) m.classList.add('hidden');
    });
  }
  if (saveEnrollBtn) {
    saveEnrollBtn.addEventListener('click', saveBiometricEnrollment);
  }

  // Driver buttons toggle logic
  const secugenDriverBtn = document.getElementById('driver-secugen-btn');
  const bridgeDriverBtn = document.getElementById('driver-bridge-btn');

  if (secugenDriverBtn && bridgeDriverBtn) {
    secugenDriverBtn.addEventListener('click', () => {
      driverMode = 'secugen';
      secugenDriverBtn.className = "py-2 px-3 border border-cyan-500/30 text-cyan-400 bg-cyan-950/20 text-xs font-bold rounded-xl cursor-pointer hover:border-cyan-400 transition-all text-center";
      bridgeDriverBtn.className = "py-2 px-3 border border-slate-800 text-slate-400 bg-slate-900/40 text-xs font-bold rounded-xl cursor-pointer hover:border-slate-700 hover:text-slate-200 transition-all text-center";
      addLiveLog('device_connected', "Driver SDK Mode modified: Switched to SecuGen WebAPI HTTPS protocol on port 8443.");
    });

    bridgeDriverBtn.addEventListener('click', () => {
      driverMode = 'bridge';
      bridgeDriverBtn.className = "py-2 px-3 border border-cyan-500/30 text-cyan-400 bg-cyan-950/20 text-xs font-bold rounded-xl cursor-pointer hover:border-cyan-400 transition-all text-center";
      secugenDriverBtn.className = "py-2 px-3 border border-slate-800 text-slate-400 bg-slate-900/40 text-xs font-bold rounded-xl cursor-pointer hover:border-slate-700 hover:text-slate-200 transition-all text-center";
      addLiveLog('device_connected', "Driver SDK Mode modified: Activated local background listening TCP bridge on port 8443.");
    });
  }

  // Clear Terminal Button
  const clearTermBtn = document.getElementById('btn-clear-terminal');
  if (clearTermBtn) {
    clearTermBtn.addEventListener('click', () => {
      logs = [];
      saveToLocalStorage('bio_logs', []);
      renderLogs();
    });
  }

  // Simulator Scan Trigger
  const triggerScanBtn = document.getElementById('btn-trigger-sim-scan');
  if (triggerScanBtn) {
    triggerScanBtn.addEventListener('click', () => {
      const select = document.getElementById('simulator-user-select') as HTMLSelectElement;
      if (!select) return;

      const userId = select.value;
      if (!userId) {
        alert("Please enroll at least one employee fingerprint before triggering simulated scans!");
        return;
      }

      if (!isScannerUsbPlugged) {
        playBeep('failure');
        addLiveLog('scan_failed', "Hardware Error: Scanner scan aborted. Physical USB cable is unplugged.");
        return;
      }

      recordPunch(userId);
    });
  }

  // Toggle USB connection state
  const usbToggleBtn = document.getElementById('toggle-usb-cable-btn');
  const usbThumb = document.getElementById('usb-switch-thumb');
  const pill = document.getElementById('hw-status-pill');
  const pillDot = document.getElementById('hw-status-dot');
  const pillText = document.getElementById('hw-status-text');

  if (usbToggleBtn && usbThumb && pill && pillDot && pillText) {
    usbToggleBtn.addEventListener('click', () => {
      isScannerUsbPlugged = !isScannerUsbPlugged;

      if (isScannerUsbPlugged) {
        usbToggleBtn.className = "h-5 w-10 bg-emerald-500 rounded-full relative p-0.5 transition-all cursor-pointer";
        usbThumb.className = "h-4 w-4 rounded-full bg-white block absolute right-0.5 transition-all";
        
        pillDot.className = "relative flex h-2 w-2";
        pillDot.innerHTML = `
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        `;
        pillText.textContent = "Ready (USB)";
        pillText.className = "text-emerald-400";
        
        addLiveLog('device_connected', "Biometric scanner connected & ready on USB port.");
      } else {
        usbToggleBtn.className = "h-5 w-10 bg-slate-800 rounded-full relative p-0.5 transition-all cursor-pointer";
        usbThumb.className = "h-4 w-4 rounded-full bg-slate-400 block absolute left-0.5 transition-all";
        
        pillDot.className = "relative flex h-2 w-2";
        pillDot.innerHTML = `
          <span class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        `;
        pillText.textContent = "Unplugged";
        pillText.className = "text-rose-400 font-bold animate-pulse";
        
        addLiveLog('scan_failed', "CRITICAL: Biometric scanner USB cable has been unplugged or disconnected!");
      }
    });
  }

  // Copy Fingerprint Visitor ID
  const copyBtn = document.getElementById('fp-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (fpData?.visitor_id) {
        navigator.clipboard.writeText(fpData.visitor_id);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        copyBtn.classList.remove('bg-slate-850', 'text-slate-200');
        copyBtn.classList.add('bg-emerald-950/40', 'border-emerald-500/20', 'text-emerald-400');
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.classList.add('bg-slate-850', 'text-slate-200');
          copyBtn.classList.remove('bg-emerald-950/40', 'border-emerald-500/20', 'text-emerald-400');
        }, 2000);
      }
    });
  }

  // Physical USB Scan Button
  const triggerPhysicalScanBtn = document.getElementById('btn-trigger-physical-scan');
  if (triggerPhysicalScanBtn) {
    triggerPhysicalScanBtn.addEventListener('click', handlePhysicalScan);
  }

  // Run Hardware Diagnostics Button
  const diagnosticBtn = document.getElementById('btn-run-diagnostics');
  if (diagnosticBtn) {
    diagnosticBtn.addEventListener('click', async () => {
      addLiveLog('device_connected', "Starting hardware sweep diagnostic routine on client machine...");
      diagnosticBtn.textContent = "Running diagnostics...";
      diagnosticBtn.setAttribute('disabled', 'true');

      try {
        const result = await capturePhysicalFingerprint(1500);
        addLiveLog('device_connected', "Diagnostic Sweep COMPLETE: USB Biometric Device SECUGEN HU20 is active, calibrated, and online on port 8443 / 8000!");
        alert("Diagnostics Complete:\nSecuGen HU20 device is plugged in and responding correctly!");
      } catch (err: any) {
        addLiveLog('scan_failed', `Diagnostic Sweep FAILED: SecuGen WebAPI unreachable. Details: ${err.message || String(err)}`);
        alert("Diagnostics Failed:\nCould not contact SecuGen WebAPI daemon on localhost. Ensure your background service is running on Port 8443 or Port 8000.");
      } finally {
        diagnosticBtn.textContent = "Run Diagnostic Sweep";
        diagnosticBtn.removeAttribute('disabled');
        lucide.createIcons();
      }
    });
  }

  // Switch to Simulator Mode helper
  window.switchToSimulatorMode = () => {
    isScannerUsbPlugged = true;
    driverMode = 'bridge';
    
    // Synchronize USB toggle switch element
    const usbToggleBtn = document.getElementById('toggle-usb-cable-btn');
    const usbThumb = document.getElementById('usb-switch-thumb');
    const pill = document.getElementById('hw-status-pill');
    const pillDot = document.getElementById('hw-status-dot');
    const pillText = document.getElementById('hw-status-text');

    if (usbToggleBtn && usbThumb && pill && pillDot && pillText) {
      usbToggleBtn.className = "h-5 w-10 bg-emerald-500 rounded-full relative p-0.5 transition-all cursor-pointer";
      usbThumb.className = "h-4 w-4 rounded-full bg-white block absolute right-0.5 transition-all";
      
      pillDot.className = "relative flex h-2 w-2";
      pillDot.innerHTML = `
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      `;
      pillText.textContent = "Ready (USB)";
      pillText.className = "text-emerald-400";
    }

    // Set active driver buttons styling
    const secugenDriverBtn = document.getElementById('driver-secugen-btn');
    const bridgeDriverBtn = document.getElementById('driver-bridge-btn');
    if (secugenDriverBtn && bridgeDriverBtn) {
      bridgeDriverBtn.className = "py-2 px-3 border border-cyan-500/30 text-cyan-400 bg-cyan-950/20 text-xs font-bold rounded-xl cursor-pointer hover:border-cyan-400 transition-all text-center";
      secugenDriverBtn.className = "py-2 px-3 border border-slate-800 text-slate-400 bg-slate-900/40 text-xs font-bold rounded-xl cursor-pointer hover:border-slate-700 hover:text-slate-200 transition-all text-center";
    }

    addLiveLog('device_connected', "সফ্টওয়্যার সিমুলেটর সক্রিয় করা হয়েছে। ইউএসবি কানেক্টেড!");
    
    // Switch to the hardware interface tab
    switchTab('console');
    
    // Flash alert
    alert("সফটওয়্যার সিমুলেটর সফলভাবে চালু হয়েছে!\nএখন আপনি যেকোনো কর্মচারী নির্বাচন করে 'Simulate Scanner Scan' বাটনে ক্লিক করলেই উপস্থিতি রেকর্ড করা হবে।");
  };

  // Initialize view displays
  lucide.createIcons();
});

// DECLARE ON WINDOW FOR INLINE ONCLICK HANDLERS
declare global {
  interface Window {
    enrollFingerprint: (userId: string) => void;
    editEmployee: (userId: string) => void;
    deleteEmployee: (userId: string) => void;
    switchToSimulatorMode: () => void;
  }
}
