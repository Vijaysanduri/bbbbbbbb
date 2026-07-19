// Dream2Fly — front-end API client
//
// Drop this near the top of employee-dashboard.html's <script> block (after
// the xlsx/Chart.js CDN tags) and replace the hardcoded `let leads = [...]`
// and `let tasks = [...]` arrays, plus the localStorage-based feature-flag
// code, with the calls below. Everything else in the dashboard (rendering,
// modals, charts) can stay exactly as it is — only where the data comes
// from changes.

const API_BASE_URL = 'http://localhost:4000/api'; // change to your deployed backend URL

function getToken() {
  return sessionStorage.getItem('d2f_token');
}
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function apiLogin(email, password) {
  const res = await fetch(API_BASE_URL + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Login failed.');
  const data = await res.json();
  sessionStorage.setItem('d2f_token', data.token);
  return data.user;
}

// ---- Leads ----
async function apiFetchLeads(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(API_BASE_URL + '/leads?' + params, { headers: authHeaders() });
  if (!res.ok) throw new Error('Could not load leads.');
  return res.json();
}
async function apiChangeLeadStatus(leadId, status) {
  const res = await fetch(API_BASE_URL + '/leads/' + leadId + '/status', {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status })
  });
  if (!res.ok) throw new Error('Could not update status.');
  return res.json(); // { lead, email, mailResult }
}
async function apiLogFollowup(leadId, type, note) {
  const res = await fetch(API_BASE_URL + '/leads/' + leadId + '/followups', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ type, note })
  });
  if (!res.ok) throw new Error('Could not log follow-up.');
  return res.json();
}
async function apiAddLeadComment(leadId, text) {
  const res = await fetch(API_BASE_URL + '/leads/' + leadId + '/comments', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error('Could not add comment.');
  return res.json();
}
async function apiConvertLead(leadId) {
  const res = await fetch(API_BASE_URL + '/leads/' + leadId + '/convert', { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || 'Could not convert lead.');
  return res.json(); // { task, message }
}

// ---- Tasks ----
async function apiFetchTasks(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(API_BASE_URL + '/tasks?' + params, { headers: authHeaders() });
  if (!res.ok) throw new Error('Could not load tasks.');
  return res.json();
}
async function apiChangeTaskStatus(taskId, status) {
  const res = await fetch(API_BASE_URL + '/tasks/' + taskId + '/status', {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status })
  });
  if (!res.ok) throw new Error('Could not update status.');
  return res.json();
}
async function apiAddTaskComment(taskId, text) {
  const res = await fetch(API_BASE_URL + '/tasks/' + taskId + '/comments', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error('Could not add comment.');
  return res.json();
}

// ---- Feature flags (replaces localStorage-based toggle) ----
async function apiFetchFeatureFlags(scope = 'EMPLOYEE') {
  const res = await fetch(API_BASE_URL + '/feature-flags?scope=' + scope, { headers: authHeaders() });
  if (!res.ok) throw new Error('Could not load feature flags.');
  return res.json();
}
async function apiSaveFeatureFlags(scope, flags) {
  const res = await fetch(API_BASE_URL + '/feature-flags', {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ scope, flags })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Could not save feature flags.');
  return res.json();
}

// ---------------------------------------------------------------------
// Example of the swap inside employee-dashboard.html's init sequence:
//
//   // BEFORE (prototype):
//   let leads = [ {...hardcoded...} ];
//   renderLeads();
//
//   // AFTER (real backend):
//   let leads = [];
//   async function loadLeadsFromServer() {
//     try {
//       leads = await apiFetchLeads();
//     } catch (err) {
//       console.error(err);
//       alert('Could not reach the server — check your connection.');
//     }
//     renderLeads();
//   }
//   loadLeadsFromServer();
//
// Same pattern applies to tasks, status changes, follow-ups, comments,
// convert-to-task, and feature flags — call the matching apiXxx() function
// instead of mutating the local array directly, then re-render.
// ---------------------------------------------------------------------
