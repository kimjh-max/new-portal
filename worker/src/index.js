/**
 * EventOS Cloudflare Worker
 * D1 (SQL Database) + R2 (Object Storage) Backend API
 */

const MAX_BACKUPS = 48; // 24시간분 (30분 × 48)

// ── CORS 헤더 (GitHub Pages에서 호출 허용) ──
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(message, status = 400) {
  return json({ success: false, error: message }, status);
}

// ── 메인 라우터 ──
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── 전체 데이터 로드 ──
      if (method === "GET" && path === "/api/data") {
        return await handleLoadAll(env);
      }

      // ── 전체 데이터 저장 ──
      if (method === "POST" && path === "/api/data") {
        const body = await request.json();
        return await handleSaveData(env, body);
      }

      // ── 프로젝트 개별 저장 ──
      if (method === "POST" && path === "/api/project") {
        const body = await request.json();
        return await handleSaveProject(env, body);
      }

      // ── 자동 백업 저장 ──
      if (method === "POST" && path === "/api/backup") {
        const body = await request.json();
        return await handleSaveBackup(env, body);
      }

      // ── 백업 이력 조회 ──
      if (method === "GET" && path === "/api/backups") {
        return await handleListBackups(env);
      }

      // ── 백업 복원 ──
      if (method === "POST" && path.startsWith("/api/backup/") && path.endsWith("/restore")) {
        const id = path.split("/")[3];
        return await handleRestoreBackup(env, parseInt(id));
      }

      // ── 문서(보고서) 데이터 저장 ──
      if (method === "POST" && path === "/api/doc") {
        const body = await request.json();
        return await handleSaveDoc(env, body);
      }

      // ── 문서(보고서) 데이터 로드 ──
      if (method === "GET" && path === "/api/doc") {
        const key = url.searchParams.get("key");
        return await handleLoadDoc(env, key);
      }

      // ── 문서(보고서) 키 목록 ──
      if (method === "GET" && path === "/api/docs") {
        return await handleListDocs(env);
      }

      // ── R2 파일 업로드 ──
      if (method === "POST" && path === "/api/files/upload") {
        const body = await request.json();
        return await handleFileUpload(env, body);
      }

      // ── R2 파일 다운로드 ──
      if (method === "GET" && path.startsWith("/api/files/")) {
        const key = decodeURIComponent(path.slice("/api/files/".length));
        return await handleFileDownload(env, key);
      }

      // ── R2 파일 삭제 ──
      if (method === "DELETE" && path.startsWith("/api/files/")) {
        const key = decodeURIComponent(path.slice("/api/files/".length));
        return await handleFileDelete(env, key);
      }

      // ── R2 파일 목록 ──
      if (method === "GET" && path === "/api/files") {
        const projectId = url.searchParams.get("projectId");
        return await handleFileList(env, projectId);
      }

      // ── 헬스체크 ──
      if (method === "GET" && (path === "/" || path === "/api/health")) {
        return json({ success: true, service: "EventOS Worker", timestamp: new Date().toISOString() });
      }

      return err("Not Found", 404);
    } catch (e) {
      return err(e.message || "Internal Server Error", 500);
    }
  },
};

// ══════════════════════════════════════════════════════════════
// D1 핸들러
// ══════════════════════════════════════════════════════════════

async function handleLoadAll(env) {
  // 시스템 데이터 로드
  const rows = await env.DB.prepare("SELECT key, value FROM app_data").all();
  const appData = {};
  for (const row of rows.results) {
    try { appData[row.key] = JSON.parse(row.value); } catch { appData[row.key] = row.value; }
  }

  // 프로젝트 데이터 로드
  const projRows = await env.DB.prepare("SELECT project_id, data FROM project_data").all();
  const projects = [];
  for (const row of projRows.results) {
    try { projects.push(JSON.parse(row.data)); } catch {}
  }

  return json({
    success: true,
    users: appData.users || [],
    priceList: appData.priceList || [],
    expenses: appData.expenses || [],
    laborCosts: appData.laborCosts || [],
    purchases: appData.purchases || [],
    projects: projects,
    loadedAt: new Date().toISOString(),
  });
}

async function handleSaveData(env, body) {
  const { users, priceList, expenses, laborCosts, purchases } = body.data || body;
  const batch = [];

  if (users) batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_data (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind("users", JSON.stringify(users)));
  if (priceList) batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_data (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind("priceList", JSON.stringify(priceList)));
  if (expenses) batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_data (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind("expenses", JSON.stringify(expenses)));
  if (laborCosts) batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_data (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind("laborCosts", JSON.stringify(laborCosts)));
  if (purchases) batch.push(env.DB.prepare("INSERT OR REPLACE INTO app_data (key, value, updated_at) VALUES (?, ?, datetime('now'))").bind("purchases", JSON.stringify(purchases)));

  if (batch.length) await env.DB.batch(batch);
  return json({ success: true, savedAt: new Date().toISOString() });
}

async function handleSaveProject(env, body) {
  const project = body.project || body;
  if (!project.id) return err("project.id required");

  await env.DB.prepare(
    "INSERT OR REPLACE INTO project_data (project_id, project_name, data, updated_at) VALUES (?, ?, ?, datetime('now'))"
  ).bind(project.id, project.name || "Unnamed", JSON.stringify(project)).run();

  return json({ success: true, projectId: project.id, savedAt: new Date().toISOString() });
}

async function handleSaveBackup(env, body) {
  const data = body.data || body;
  const projectCount = (data.projects || []).length;

  await env.DB.prepare(
    "INSERT INTO backups (backup_type, data, project_count, created_at) VALUES (?, ?, ?, datetime('now'))"
  ).bind(body.type || "auto", JSON.stringify(data), projectCount).run();

  // 오래된 백업 정리 (MAX_BACKUPS 초과 시)
  const count = await env.DB.prepare("SELECT COUNT(*) as cnt FROM backups").first();
  if (count.cnt > MAX_BACKUPS) {
    await env.DB.prepare(
      `DELETE FROM backups WHERE id IN (
        SELECT id FROM backups ORDER BY created_at ASC LIMIT ?
      )`
    ).bind(count.cnt - MAX_BACKUPS).run();
  }

  // R2에도 장기 백업 저장 (JSON 파일)
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const r2Key = `backups/backup_${ts}.json`;
  await env.BUCKET.put(r2Key, JSON.stringify(data), {
    httpMetadata: { contentType: "application/json" },
  });

  return json({ success: true, totalBackups: Math.min(count.cnt, MAX_BACKUPS), savedAt: new Date().toISOString() });
}

async function handleListBackups(env) {
  const rows = await env.DB.prepare(
    "SELECT id, backup_type, project_count, created_at FROM backups ORDER BY created_at DESC LIMIT 48"
  ).all();

  return json({ success: true, backups: rows.results });
}

async function handleRestoreBackup(env, id) {
  const row = await env.DB.prepare("SELECT data FROM backups WHERE id = ?").bind(id).first();
  if (!row) return err("Backup not found", 404);

  let data;
  try { data = JSON.parse(row.data); } catch { return err("Backup data corrupted"); }
  return json({ success: true, data });
}

// ══════════════════════════════════════════════════════════════
// 문서(보고서) 핸들러
// ══════════════════════════════════════════════════════════════

async function handleSaveDoc(env, body) {
  const { key, data } = body;
  if (!key) return err("key required");
  if (data === undefined || data === null) return err("data required");

  // doc_data 테이블 없으면 자동 생성
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS doc_data (doc_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))"
  ).run();

  await env.DB.prepare(
    "INSERT OR REPLACE INTO doc_data (doc_key, data, updated_at) VALUES (?, ?, datetime('now'))"
  ).bind(key, JSON.stringify(data)).run();

  return json({ success: true, key, savedAt: new Date().toISOString() });
}

async function handleLoadDoc(env, key) {
  if (!key) return err("key query parameter required");

  // doc_data 테이블 없으면 자동 생성
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS doc_data (doc_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))"
  ).run();

  const row = await env.DB.prepare("SELECT data, updated_at FROM doc_data WHERE doc_key = ?").bind(key).first();
  if (!row) return json({ success: true, data: null, found: false });

  let data;
  try { data = JSON.parse(row.data); } catch { data = row.data; }
  return json({ success: true, data, found: true, updatedAt: row.updated_at });
}

async function handleListDocs(env) {
  // doc_data 테이블 없으면 자동 생성
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS doc_data (doc_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))"
  ).run();

  const rows = await env.DB.prepare(
    "SELECT doc_key, updated_at FROM doc_data ORDER BY updated_at DESC"
  ).all();

  return json({ success: true, docs: rows.results });
}

// ══════════════════════════════════════════════════════════════
// R2 핸들러
// ══════════════════════════════════════════════════════════════

async function handleFileUpload(env, body) {
  const { projectId, fileName, base64Data, mimeType, uploadedBy } = body;
  if (!fileName || !base64Data) return err("fileName and base64Data required");

  const fileKey = projectId ? `projects/${projectId}/files/${fileName}` : `files/${fileName}`;

  // base64 → binary
  const binary = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  await env.BUCKET.put(fileKey, binary, {
    httpMetadata: { contentType: mimeType || "application/octet-stream" },
  });

  // 메타데이터 D1에 저장
  await env.DB.prepare(
    "INSERT OR REPLACE INTO files_meta (project_id, file_key, file_name, mime_type, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(projectId || 0, fileKey, fileName, mimeType || "", binary.length, uploadedBy || "", ).run();

  return json({ success: true, fileKey, size: binary.length, uploadedAt: new Date().toISOString() });
}

async function handleFileDownload(env, key) {
  const object = await env.BUCKET.get(key);
  if (!object) return err("File not found", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`,
      ...CORS,
    },
  });
}

async function handleFileDelete(env, key) {
  await env.BUCKET.delete(key);
  await env.DB.prepare("DELETE FROM files_meta WHERE file_key = ?").bind(key).run();
  return json({ success: true });
}

async function handleFileList(env, projectId) {
  let rows;
  if (projectId) {
    rows = await env.DB.prepare(
      "SELECT file_key, file_name, mime_type, size, uploaded_by, created_at FROM files_meta WHERE project_id = ? ORDER BY created_at DESC"
    ).bind(parseInt(projectId)).all();
  } else {
    rows = await env.DB.prepare(
      "SELECT file_key, file_name, mime_type, size, uploaded_by, created_at FROM files_meta ORDER BY created_at DESC LIMIT 100"
    ).all();
  }
  return json({ success: true, files: rows.results });
}
