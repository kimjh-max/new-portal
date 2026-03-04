-- EventOS D1 Database Schema
-- 앱 데이터를 JSON blob으로 저장 (프론트엔드 호환성 최대화)

-- 시스템 데이터 (users, priceList, expenses, laborCosts, purchases)
CREATE TABLE IF NOT EXISTS app_data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 프로젝트별 데이터 (각 프로젝트 전체를 JSON으로)
CREATE TABLE IF NOT EXISTS project_data (
  project_id INTEGER PRIMARY KEY,
  project_name TEXT,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 자동 백업 이력 (30분마다)
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT DEFAULT 'auto',
  data TEXT NOT NULL,
  project_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- R2 파일 메타데이터
CREATE TABLE IF NOT EXISTS files_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  file_key TEXT UNIQUE NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER DEFAULT 0,
  uploaded_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(backup_type);
CREATE INDEX IF NOT EXISTS idx_files_project ON files_meta(project_id);
CREATE INDEX IF NOT EXISTS idx_project_name ON project_data(project_name);
