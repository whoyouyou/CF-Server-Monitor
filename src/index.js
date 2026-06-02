import { initDatabase, cleanupOldData, getMetricsHistory } from './database/schema.js';
import { checkOfflineNodes } from './services/notification.js';
import { updateDatabase, cleanupStaleSettings } from './database/updateDatabase.js';
import { handleAdminAPI } from './handlers/admin.js';
import { serveFrontend } from './handlers/frontend.js';
import { handleUpdate } from './handlers/update.js';
import { handleServerAPI, handleServersAPI } from './handlers/dashboard.js';
import { loadSettings } from './utils/settings.js';
import { checkAuth, authResponse, simpleAuthResponse } from './middleware/auth.js';

const historyCache = new Map();
const CACHE_TTL = 60000;
const MAX_HOURS_LONG = 24;
const MAX_HOURS_SHORT = 1;

async function fetchHistoryData(env, request, id, hours, columns) {
  if (!id) return new Response('Missing ID', { status: 400 });
  
  const isLoggedIn = checkAuth(request, env);
  const sys = await loadSettings(env.DB);
  const enableLongRetention = env.LONG_RETENTION === 'true';
  const maxHours = enableLongRetention ? MAX_HOURS_LONG : MAX_HOURS_SHORT;
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  let query = 'SELECT id FROM servers WHERE id = ?';
  if (!isLoggedIn) {
    query += " AND (is_hidden != '1' AND is_hidden != 1)";
  }
  const server = await env.DB.prepare(query).bind(id).first();
  if (!server) return new Response('Not Found', { status: 404 });
  
  const clampedHours = Math.min(hours, maxHours);
  
  const cacheKey = `${id}_${clampedHours}_${columns}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return new Response(JSON.stringify(cached.data), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
    });
  }
  
  const data = await getMetricsHistory(env.DB, id, clampedHours, columns);
  
  historyCache.set(cacheKey, {
    timestamp: Date.now(),
    data: data
  });
  
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
  });
}

export default {
  async fetch(request, env, ctx) {
    await initDatabase(env.DB);

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (env.ASSETS && method === 'GET') {
      try {
        const res = await env.ASSETS.fetch(new Request(`http://static${path}`, request));
        if (res.ok) {
          return res;
        }
      } catch (e) {
      }
    }

    async function handleManualCleanup() {
      if (!checkAuth(request, env)) {
        const sys = await loadSettings(env.DB);
        return authResponse(sys.admin_title);
      }
      
      const result = await cleanupOldData(env.DB);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    async function handleUpdateDatabase() {
      if (!checkAuth(request, env)) {
        const sys = await loadSettings(env.DB);
        return authResponse(sys.admin_title);
      }
      
      const result = await updateDatabase(env.DB);
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    async function handleGetConfig() {
      const enableLongRetention = env.LONG_RETENTION === 'true';
      return new Response(JSON.stringify({ enableLongRetention }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const routes = [
      { method: 'GET', path: '/clear', handler: handleManualCleanup },
      { method: 'GET', path: '/updateDatabase', handler: handleUpdateDatabase },
      { method: 'POST', path: '/admin/api', handler: async () => {
        const sys = await loadSettings(env.DB);
        return handleAdminAPI(request, env, sys);
      }},
      { method: 'POST', path: '/update', handler: () => handleUpdate(request, env, ctx) },
      { method: 'GET', path: '/api/server', handler: async () => {
        const sys = await loadSettings(env.DB);
        return handleServerAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/servers', handler: async () => {
        const sys = await loadSettings(env.DB);
        return handleServersAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/config', handler: handleGetConfig },
      { method: 'GET', path: '/api/history', handler: async () => {
        const id = url.searchParams.get('id');
        const metric = url.searchParams.get('metric') || 'cpu';
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        return fetchHistoryData(env, request, id, hours, metric);
      }},
      { method: 'GET', path: '/api/history/all', handler: async () => {
        const id = url.searchParams.get('id');
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        const allColumns = 'cpu, ram, disk, processes, net_in_speed, net_out_speed, tcp_conn, udp_conn, ping_ct, ping_cu, ping_cm, ping_bd, swap_total, swap_used, load_avg';
        return fetchHistoryData(env, request, id, hours, allColumns);
      }}
    ];

    for (const route of routes) {
      if (route.method === method && route.path === path) {
        return route.handler();
      }
    }

    return serveFrontend(request, env);
  },

  async scheduled(event, env, ctx) {
    await initDatabase(env.DB);
    
    const cron = event.cron;
    console.log(`[Cron] 定时任务触发: ${cron}`);
    
    if (cron === '10 0 * * *') {
      console.log('[Cron] 开始执行每日数据清理任务');
      await cleanupOldData(env.DB);
      console.log('[Cron] 每日数据清理任务完成');
    } else if (cron === '*/1 * * * *') {
      console.log('[Cron] 开始执行离线节点检测');
      await checkOfflineNodes(env.DB);
      console.log('[Cron] 离线节点检测完成');
    }
  }
};