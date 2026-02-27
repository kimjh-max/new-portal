/**
 * EventOS Portal - Google Apps Script (Google Drive 연동)
 *
 * 사용법:
 * 1. https://script.google.com 접속
 * 2. 새 프로젝트 생성
 * 3. 이 코드 전체를 Code.gs에 붙여넣기
 * 4. 배포 > 새 배포 > 웹 앱
 *    - 다음 사용자 인증으로 실행: "나"
 *    - 액세스 권한: "모든 사용자"
 * 5. 배포 URL을 EventOS.html의 DRIVE_CONFIG.GAS_URL에 설정
 */

// ═══ 설정 ═══════════════════════════════════════════════════════════════════
const ROOT_FOLDER_ID = "17KmQNhns3Q35o2psQIw7NMBs3BawdRcu";
const SYSTEM_DATA_FILE = "_appData.json";
const PROJECT_DATA_FILE = "_projectData.json";

// ═══ GET 요청 처리 ═════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === "loadAll") {
      return jsonResponse(loadAllData());
    }

    if (action === "listFiles") {
      const projectName = e.parameter.projectName;
      if (!projectName) return jsonResponse({ error: "projectName required" });
      return jsonResponse({ files: listProjectFiles(projectName) });
    }

    if (action === "downloadFile") {
      const fileId = e.parameter.fileId;
      if (!fileId) return jsonResponse({ error: "fileId required" });
      const file = DriveApp.getFileById(fileId);
      return jsonResponse({
        name: file.getName(),
        mimeType: file.getMimeType(),
        downloadUrl: file.getDownloadUrl(),
        webViewLink: file.getUrl(),
      });
    }

    if (action === "ping") {
      return jsonResponse({ ok: true, timestamp: new Date().toISOString() });
    }

    return jsonResponse({ error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ═══ POST 요청 처리 ════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === "saveAppData") {
      saveAppData(body.data);
      return jsonResponse({ ok: true, timestamp: new Date().toISOString() });
    }

    if (action === "saveProject") {
      saveProjectData(body.project);
      return jsonResponse({ ok: true, timestamp: new Date().toISOString() });
    }

    if (action === "uploadFile") {
      const result = uploadFile(body.projectName, body.fileName, body.base64Data, body.mimeType);
      return jsonResponse(result);
    }

    if (action === "deleteFile") {
      const file = DriveApp.getFileById(body.fileId);
      file.setTrashed(true);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ═══ 핵심 함수 ═════════════════════════════════════════════════════════════

/**
 * 전체 데이터 로드
 */
function loadAllData() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const result = { users: [], priceList: [], expenses: [], laborCosts: [], purchases: [], projects: [] };

  // _appData.json 로드
  const appDataFile = findFile(root, SYSTEM_DATA_FILE);
  if (appDataFile) {
    const appData = JSON.parse(appDataFile.getBlob().getDataAsString());
    if (appData.users) result.users = appData.users;
    if (appData.priceList) result.priceList = appData.priceList;
    if (appData.expenses) result.expenses = appData.expenses;
    if (appData.laborCosts) result.laborCosts = appData.laborCosts;
    if (appData.purchases) result.purchases = appData.purchases;
  }

  // 각 프로젝트 폴더에서 _projectData.json 로드
  const folders = root.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    const folderName = folder.getName();
    if (folderName.startsWith("_")) continue; // 시스템 폴더 스킵

    const projFile = findFile(folder, PROJECT_DATA_FILE);
    if (projFile) {
      try {
        const projData = JSON.parse(projFile.getBlob().getDataAsString());
        if (projData.project) {
          // 파일 목록도 함께 수집
          projData.project.driveFiles = getFilesInFolder(folder);
          result.projects.push(projData.project);
        }
      } catch (parseErr) {
        Logger.log("Error parsing project in " + folderName + ": " + parseErr.message);
      }
    }
  }

  result.timestamp = new Date().toISOString();
  return result;
}

/**
 * 시스템 데이터 저장 (users, priceList, expenses, laborCosts, purchases)
 */
function saveAppData(data) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const payload = {
    users: data.users || [],
    priceList: data.priceList || [],
    expenses: data.expenses || [],
    laborCosts: data.laborCosts || [],
    purchases: data.purchases || [],
    lastModified: new Date().toISOString(),
  };

  upsertJsonFile(root, SYSTEM_DATA_FILE, payload);
}

/**
 * 프로젝트 데이터 저장 (프로젝트명 폴더에 저장)
 */
function saveProjectData(project) {
  if (!project || !project.name) throw new Error("project.name is required");

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const folder = getOrCreateFolder(root, project.name);

  const payload = {
    project: project,
    lastModified: new Date().toISOString(),
  };

  upsertJsonFile(folder, PROJECT_DATA_FILE, payload);
}

/**
 * 파일 업로드 (프로젝트 폴더에 저장)
 */
function uploadFile(projectName, fileName, base64Data, mimeType) {
  if (!projectName || !fileName || !base64Data) {
    throw new Error("projectName, fileName, base64Data required");
  }

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const folder = getOrCreateFolder(root, projectName);

  // base64 디코딩
  const decoded = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(decoded, mimeType || "application/octet-stream", fileName);

  // 같은 이름 파일이 있으면 덮어쓰기 (기존 파일 삭제)
  const existing = findFile(folder, fileName);
  if (existing) existing.setTrashed(true);

  const file = folder.createFile(blob);

  return {
    ok: true,
    fileId: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: file.getSize(),
    url: file.getUrl(),
    downloadUrl: file.getDownloadUrl(),
    uploadedAt: new Date().toISOString(),
  };
}

// ═══ 유틸리티 함수 ═════════════════════════════════════════════════════════

/**
 * 폴더 내 파일 찾기
 */
function findFile(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

/**
 * 하위 폴더 가져오기 (없으면 생성)
 */
function getOrCreateFolder(parent, folderName) {
  const folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(folderName);
}

/**
 * JSON 파일 생성 또는 업데이트
 */
function upsertJsonFile(folder, fileName, data) {
  const json = JSON.stringify(data, null, 2);
  const existing = findFile(folder, fileName);

  if (existing) {
    existing.setContent(json);
  } else {
    folder.createFile(fileName, json, "application/json");
  }
}

/**
 * 폴더 내 파일 목록 (시스템 파일 제외)
 */
function getFilesInFolder(folder) {
  const result = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (name.startsWith("_")) continue; // _projectData.json 등 시스템 파일 스킵
    result.push({
      fileId: file.getId(),
      name: name,
      mimeType: file.getMimeType(),
      size: file.getSize(),
      url: file.getUrl(),
      downloadUrl: file.getDownloadUrl(),
      lastUpdated: file.getLastUpdated().toISOString(),
    });
  }
  return result;
}

/**
 * JSON 응답 생성
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
