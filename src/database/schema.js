let dbInitialized = false;
const DELETE_RAW_DATA = false; // true:删除超过1天的原始数据; false:删除超过3天的原始数据; 都不删除1天内的原始数据
const RETENTION_DAYS = 1; // 数据保留天数

export async function initDatabase(db) {
  if (dbInitialized) return;
  
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, 
        value TEXT
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT,
        server_group TEXT DEFAULT 'Default',
        price TEXT DEFAULT '',
        expire_date TEXT DEFAULT '',
        bandwidth TEXT DEFAULT '',
        traffic_limit TEXT DEFAULT '',
        is_hidden TEXT DEFAULT '0',
        sort_order INTEGER DEFAULT 0
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS metrics_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        timestamp INTEGER DEFAULT 0,
        cpu REAL DEFAULT 0,
        ram REAL DEFAULT 0,
        disk REAL DEFAULT 0,
        load_avg TEXT DEFAULT '0',
        net_in_speed REAL DEFAULT 0,
        net_out_speed REAL DEFAULT 0,
        net_rx REAL DEFAULT 0,
        net_tx REAL DEFAULT 0,
        processes INTEGER DEFAULT 0,
        tcp_conn INTEGER DEFAULT 0,
        udp_conn INTEGER DEFAULT 0,
        ping_ct INTEGER DEFAULT 0,
        ping_cu INTEGER DEFAULT 0,
        ping_cm INTEGER DEFAULT 0,
        ping_bd INTEGER DEFAULT 0,
        ram_total REAL DEFAULT 0,
        ram_used REAL DEFAULT 0,
        swap_total REAL DEFAULT 0,
        swap_used REAL DEFAULT 0,
        disk_total REAL DEFAULT 0,
        disk_used REAL DEFAULT 0,
        cpu_cores INTEGER DEFAULT 0,
        cpu_info TEXT DEFAULT '',
        arch TEXT DEFAULT '',
        os TEXT DEFAULT '',
        country TEXT DEFAULT '',
        ip_v4 TEXT DEFAULT '0',
        ip_v6 TEXT DEFAULT '0',
        boot_time TEXT DEFAULT '',
        FOREIGN KEY (server_id) REFERENCES servers(id)
      )
    `).run();

    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_history_server_time 
      ON metrics_history(server_id, timestamp)
    `).run();

    console.log('✅ 数据库初始化完成');
    dbInitialized = true;
  } catch (e) {
    console.error('❌ 数据库初始化失败:', e);
  }
}

export async function getMetricsHistory(db, serverId, hours, columns) {
  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;

  console.log(
    '[History]',
    'server:', serverId,
    'hours:', hours,
    'cutoff:', new Date(cutoff).toISOString()
  );

  const rawResult = await db.prepare(`
    SELECT timestamp, ${columns}
    FROM metrics_history
    WHERE server_id = ?
      AND typeof(timestamp) = 'integer'
      AND timestamp >= ?
  `).bind(serverId, cutoff).all();

  const result = rawResult.results.map(row => ({
    ...row,
    timestamp: Number(row.timestamp)
  }));

  result.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[History] FINAL: ${result.length}`);

  return result;
}

export async function cleanupOldData(db) {
  try {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const rawRetentionDays = DELETE_RAW_DATA ? oneDay : threeDays;
    
    const stats = {
      expired: 0,
      deleted: 0
    };
    
    const rawCutoff = now - rawRetentionDays;
    const intDeleteResult = await db.prepare(
      `DELETE FROM metrics_history WHERE typeof(timestamp) = 'integer' AND timestamp < ?`
    ).bind(rawCutoff).run();
    stats.expired = intDeleteResult.meta.changes || 0;
    stats.deleted += stats.expired;
    
    const totalDeleted = stats.deleted;
    
    if (totalDeleted > 0) {
      console.log(`[Cleanup] 清理 ${totalDeleted} 条过期数据`);
    }
    
    return {
      success: true,
      deleted: totalDeleted,
      expired: stats.expired
    };
  } catch (e) {
    console.error('[Cleanup] 清理数据失败:', e);
    return { success: false, error: e.message };
  }
}

export async function saveMetricsHistory(db, serverId, metrics, countryCode = '') {
  try {
    const now = Date.now();
    await db.prepare(`
      INSERT INTO metrics_history (
        server_id, timestamp, cpu, ram, disk, load_avg,
        net_in_speed, net_out_speed, net_rx, net_tx,
        processes, tcp_conn, udp_conn,
        ping_ct, ping_cu, ping_cm, ping_bd,
        ram_total, ram_used, swap_total, swap_used,
        disk_total, disk_used,
        cpu_cores, cpu_info, arch, os, country, ip_v4, ip_v6, boot_time
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).bind(
      serverId,
      now,
      parseFloat(metrics.cpu) || 0,
      parseFloat(metrics.ram) || 0,
      parseFloat(metrics.disk) || 0,
      metrics.load || '0',
      parseFloat(metrics.net_in_speed) || 0,
      parseFloat(metrics.net_out_speed) || 0,
      parseFloat(metrics.net_rx) || 0,
      parseFloat(metrics.net_tx) || 0,
      parseInt(metrics.processes) || 0,
      parseInt(metrics.tcp_conn) || 0,
      parseInt(metrics.udp_conn) || 0,
      parseInt(metrics.ping_ct) || 0,
      parseInt(metrics.ping_cu) || 0,
      parseInt(metrics.ping_cm) || 0,
      parseInt(metrics.ping_bd) || 0,
      parseFloat(metrics.ram_total) || 0,
      parseFloat(metrics.ram_used) || 0,
      parseFloat(metrics.swap_total) || 0,
      parseFloat(metrics.swap_used) || 0,
      parseFloat(metrics.disk_total) || 0,
      parseFloat(metrics.disk_used) || 0,
      parseInt(metrics.cpu_cores) || 0,
      metrics.cpu_info || '',
      metrics.arch || '',
      metrics.os || '',
      countryCode,
      metrics.ip_v4 || '0',
      metrics.ip_v6 || '0',
      metrics.boot_time || ''
    ).run();
  } catch (e) {
    console.error('保存历史数据失败:', e);
  }
}

export async function getLatestMetrics(db, serverId) {
  try {
    const result = await db.prepare(`
      SELECT * FROM metrics_history 
      WHERE server_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `).bind(serverId).first();
    
    return result || null;
  } catch (e) {
    console.error('获取最新指标数据失败:', e);
    return null;
  }
}

export async function getLatestMetricsForAllServers(db) {
  try {
    const { results: servers } = await db.prepare('SELECT id FROM servers').all();

    const entries = await Promise.all(
      servers.map(s =>
        getLatestMetrics(db, s.id).then(metrics => [s.id, metrics])
      )
    );

    return new Map(entries.filter(([, m]) => m !== null));
  } catch (e) {
    console.error('获取所有服务器最新指标数据失败:', e);
    return new Map();
  }
}