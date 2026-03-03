/**
 * EventOS Google Apps Script Backend
 * Google Drive 자동 동기화 + 백업 시스템
 *
 * 📌 배포 방법:
 * 1. https://script.google.com 접속
 * 2. 새 프로젝트 생성
 * 3. 이 코드를 Code.gs에 붙여넣기
 * 4. 배포 > 새 배포 > 웹 앱 선택
 * 5. "다음 사용자 인증으로 실행: 나"
 * 6. "액세스 권한: 모든 사용자"
 * 7. 배포 URL 복사 → EventOS.html의 DRIVE_CONFIG.GAS_URL에 입력
 */

// ─── 설정 ──────────────────────────────────────────────
const ROOT_FOLDER_ID = "0ACU1M-ct4JPoUk9PVA";
const MAX_BACKUPS = 48; // 30분 × 48 = 24시간 보관

// ─── 유틸리티 함수 ─────────────────────────────────────
function getOrCreateFolder(parentId, folderName) {
  const parent = DriveApp.getFolderById(parentId);
  const folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(folderName);
}

function saveJsonFile(folderId, fileName, data) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(fileName);
  const content = JSON.stringify(data, null, 2);
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(content);
    return file.getId();
  }
  const newFile = folder.createFile(fileName, content, "application/json");
  return newFile.getId();
}

function readJsonFile(folderId, fileName) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) return null;
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (e) {
    return null;
  }
}

function makeResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── GET 핸들러 ────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || "";

    // 전체 데이터 로드
    if (action === "loadAll") {
      const appData = readJsonFile(ROOT_FOLDER_ID, "_appData.json") || {};

      // 프로젝트별 데이터 수집
      const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
      const subFolders = root.getFolders();
      const projects = [];

      while (subFolders.hasNext()) {
        const folder = subFolders.next();
        const name = folder.getName();
        if (name.startsWith("_")) continue; // _backups 등 시스템 폴더 스킵
        const projData = readJsonFile(folder.getId(), "_projectData.json");
        if (projData) projects.push(projData);
      }

      return makeResponse({
        success: true,
        users: appData.users || [],
        priceList: appData.priceList || [],
        expenses: appData.expenses || [],
        laborCosts: appData.laborCosts || [],
        purchases: appData.purchases || [],
        projects: projects,
        loadedAt: new Date().toISOString()
      });
    }

    // 프로젝트 파일 목록
    if (action === "listFiles") {
      const projectName = e.parameter.projectName || "";
      if (!projectName) return makeResponse({ success: false, error: "projectName required" });

      const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
      const folders = root.getFoldersByName(projectName);
      if (!folders.hasNext()) return makeResponse({ success: true, files: [] });

      const folder = folders.next();
      const fileIter = folder.getFiles();
      const fileList = [];
      while (fileIter.hasNext()) {
        const f = fileIter.next();
        if (f.getName().startsWith("_")) continue;
        fileList.push({
          id: f.getId(),
          name: f.getName(),
          mimeType: f.getMimeType(),
          size: f.getSize(),
          url: f.getUrl(),
          updatedAt: f.getLastUpdated().toISOString()
        });
      }
      return makeResponse({ success: true, files: fileList });
    }

    // 파일 다운로드 URL
    if (action === "downloadFile") {
      const fileId = e.parameter.fileId || "";
      if (!fileId) return makeResponse({ success: false, error: "fileId required" });
      const file = DriveApp.getFileById(fileId);
      return makeResponse({
        success: true,
        url: file.getDownloadUrl(),
        name: file.getName(),
        mimeType: file.getMimeType()
      });
    }

    // 백업 이력 목록
    if (action === "listBackups") {
      const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
      const bFolders = root.getFoldersByName("_backups");
      if (!bFolders.hasNext()) return makeResponse({ success: true, backups: [] });

      const bFolder = bFolders.next();
      const fileIter = bFolder.getFiles();
      const backups = [];
      while (fileIter.hasNext()) {
        const f = fileIter.next();
        backups.push({
          id: f.getId(),
          name: f.getName(),
          size: f.getSize(),
          createdAt: f.getDateCreated().toISOString()
        });
      }
      backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return makeResponse({ success: true, backups: backups });
    }

    return makeResponse({ success: false, error: "Unknown action: " + action });

  } catch (err) {
    return makeResponse({ success: false, error: err.toString() });
  }
}

// ─── POST 핸들러 ───────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "";

    // 시스템 데이터 저장 (users, priceList, expenses 등)
    if (action === "saveAppData") {
      const data = body.data || {};
      saveJsonFile(ROOT_FOLDER_ID, "_appData.json", data);
      return makeResponse({ success: true, savedAt: new Date().toISOString() });
    }

    // 프로젝트 데이터 저장
    if (action.startsWith("saveProject")) {
      const project = body.project || {};
      const projectName = project.name || "Unnamed";
      const folder = getOrCreateFolder(ROOT_FOLDER_ID, projectName);
      saveJsonFile(folder.getId(), "_projectData.json", project);
      return makeResponse({ success: true, projectName: projectName, savedAt: new Date().toISOString() });
    }

    // 자동 백업 저장
    if (action === "saveBackup") {
      const data = body.data || {};
      const bFolder = getOrCreateFolder(ROOT_FOLDER_ID, "_backups");

      // 파일명: backup_20260303_1430.json
      const now = new Date();
      const ts = Utilities.formatDate(now, "Asia/Seoul", "yyyyMMdd_HHmm");
      const fileName = "backup_" + ts + ".json";

      saveJsonFile(bFolder.getId(), fileName, data);

      // 오래된 백업 정리 (MAX_BACKUPS 초과 시)
      const fileIter = bFolder.getFiles();
      const allFiles = [];
      while (fileIter.hasNext()) {
        const f = fileIter.next();
        allFiles.push({ file: f, created: f.getDateCreated().getTime() });
      }
      allFiles.sort((a, b) => b.created - a.created); // 최신순

      if (allFiles.length > MAX_BACKUPS) {
        for (let i = MAX_BACKUPS; i < allFiles.length; i++) {
          allFiles[i].file.setTrashed(true);
        }
      }

      return makeResponse({
        success: true,
        fileName: fileName,
        totalBackups: Math.min(allFiles.length, MAX_BACKUPS),
        savedAt: now.toISOString()
      });
    }

    // 파일 업로드
    if (action === "uploadFile") {
      const projectName = body.projectName || "Unnamed";
      const fileName = body.fileName || "file";
      const base64Data = body.base64Data || "";
      const mimeType = body.mimeType || "application/octet-stream";

      const folder = getOrCreateFolder(ROOT_FOLDER_ID, projectName);

      // 동일 파일명 있으면 덮어쓰기
      const existing = folder.getFilesByName(fileName);
      if (existing.hasNext()) existing.next().setTrashed(true);

      const decoded = Utilities.base64Decode(base64Data);
      const blob = Utilities.newBlob(decoded, mimeType, fileName);
      const file = folder.createFile(blob);

      return makeResponse({
        success: true,
        fileId: file.getId(),
        url: file.getUrl(),
        name: file.getName(),
        size: file.getSize(),
        uploadedAt: new Date().toISOString()
      });
    }

    // 파일 삭제
    if (action === "deleteFile") {
      const fileId = body.fileId || "";
      if (!fileId) return makeResponse({ success: false, error: "fileId required" });
      DriveApp.getFileById(fileId).setTrashed(true);
      return makeResponse({ success: true });
    }

    return makeResponse({ success: false, error: "Unknown action: " + action });

  } catch (err) {
    return makeResponse({ success: false, error: err.toString() });
  }
}
