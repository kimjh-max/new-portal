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

    // 📧 이메일 발송 (긴급 과업 알림)
    if (action === "sendEmail") {
      const to = body.to || "";
      const subject = body.subject || "[EventOS] 알림";
      const htmlBody = body.htmlBody || "";

      if (!to) return makeResponse({ success: false, error: "수신자 이메일(to)이 필요합니다" });

      // GmailApp 대신 MailApp 사용 (Gmail 권한 불필요)
      MailApp.sendEmail({
        to: to,
        subject: subject,
        htmlBody: htmlBody,
        name: "EventOS 알림 시스템",
      });

      Logger.log("[EventOS] 📧 이메일 발송: " + to + " | " + subject);

      return makeResponse({
        success: true,
        to: to,
        subject: subject,
        sentAt: new Date().toISOString()
      });
    }

    return makeResponse({ success: false, error: "Unknown action: " + action });

  } catch (err) {
    return makeResponse({ success: false, error: err.toString() });
  }
}

// ─── 매일 아침 자동 긴급 과업 이메일 ─────────────────────

/**
 * 서버사이드: 매일 아침 10시(KST) 자동 실행
 * Drive에서 프로젝트 데이터를 읽고, 긴급 과업이 있는 담당자에게 이메일 발송
 */
function sendDailyUrgentEmails() {
  try {
    // 1. 사용자 목록 로드 (이메일 포함)
    const appData = readJsonFile(ROOT_FOLDER_ID, "_appData.json");
    if (!appData) {
      Logger.log("[EventOS] _appData.json not found");
      return;
    }
    const users = appData.users || [];

    // 이메일이 있는 사용자만
    const usersWithEmail = users.filter(function(u) { return u.email && u.email.trim(); });
    if (usersWithEmail.length === 0) {
      Logger.log("[EventOS] No users with email found");
      return;
    }

    // 2. 프로젝트 데이터 로드
    const allProjects = [];
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const subFolders = root.getFolders();
    while (subFolders.hasNext()) {
      const folder = subFolders.next();
      if (folder.getName().startsWith("_")) continue;
      const projData = readJsonFile(folder.getId(), "_projectData.json");
      if (projData) {
        const project = projData.project || projData;
        if (project.name) allProjects.push(project);
      }
    }

    // 3. 오늘 날짜 기준 3일 이내 긴급 과업 수집
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const todayStr = Utilities.formatDate(today, "Asia/Seoul", "yyyy-MM-dd");
    const threeStr = Utilities.formatDate(threeDaysLater, "Asia/Seoul", "yyyy-MM-dd");

    const tasksByUser = {};

    allProjects.forEach(function(project) {
      (project.gantt || []).forEach(function(ganttItem) {
        (ganttItem.subtasks || []).forEach(function(subtask) {
          if (subtask.done) return;
          if (!subtask.endDate) return;
          if (!subtask.assignee) return;

          if (subtask.endDate <= threeStr) {
            var assignee = subtask.assignee;
            if (!tasksByUser[assignee]) tasksByUser[assignee] = [];

            var endDate = new Date(subtask.endDate + "T00:00:00+09:00");
            var diffMs = endDate.getTime() - today.getTime();
            var diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            tasksByUser[assignee].push({
              projectName: project.name,
              division: ganttItem.division || ganttItem.task || "",
              taskName: subtask.task,
              endDate: subtask.endDate,
              dDay: diffDays,
              assignee: assignee,
            });
          }
        });
      });
    });

    var sentCount = 0;

    usersWithEmail.forEach(function(user) {
      var userName = user.name;
      var userEmail = user.email.trim();
      var tasks = tasksByUser[userName];

      if (!tasks || tasks.length === 0) return;

      tasks.sort(function(a, b) { return a.endDate.localeCompare(b.endDate); });

      var htmlBody = buildUrgentEmailHtml(userName, tasks, todayStr);
      var subject = "[EventOS] 📋 " + userName + "님, 긴급 과업 " + tasks.length + "건 알림 (" + todayStr + ")";

      try {
        MailApp.sendEmail({
          to: userEmail,
          subject: subject,
          htmlBody: htmlBody,
          name: "EventOS 알림 시스템",
        });
        sentCount++;
        Logger.log("[EventOS] 📧 일일 알림 발송: " + userEmail + " (" + tasks.length + "건)");
      } catch (mailErr) {
        Logger.log("[EventOS] 📧 발송 실패: " + userEmail + " - " + mailErr.message);
      }
    });

    Logger.log("[EventOS] ✅ 일일 긴급 과업 알림 완료: " + sentCount + "명에게 발송");

  } catch (err) {
    Logger.log("[EventOS] ❌ sendDailyUrgentEmails 에러: " + err.message);
  }
}

/**
 * 긴급 과업 이메일 HTML 생성
 */
function buildUrgentEmailHtml(userName, tasks, todayStr) {
  var overdueRows = "";
  var urgentRows = "";

  tasks.forEach(function(t) {
    var dDayText = t.dDay < 0 ? "D+" + Math.abs(t.dDay) : t.dDay === 0 ? "D-Day" : "D-" + t.dDay;
    var dDayColor = t.dDay < 0 ? "#ef4444" : t.dDay === 0 ? "#f97316" : "#eab308";
    var bgColor = t.dDay < 0 ? "#fef2f2" : "#fffbeb";

    var row =
      '<tr style="background:' + bgColor + '">' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">' + t.projectName + "</td>" +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">' + t.division + "</td>" +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">' + t.taskName + "</td>" +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">' + t.endDate + "</td>" +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">' +
      '<span style="background:' + dDayColor + ";color:white;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700\">" + dDayText + "</span>" +
      "</td>" +
      "</tr>";

    if (t.dDay < 0) overdueRows += row;
    else urgentRows += row;
  });

  var overdueCount = tasks.filter(function(t) { return t.dDay < 0; }).length;
  var urgentCount = tasks.length - overdueCount;

  return (
    '<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#f8fafc">' +
    '<div style="background:white;border-radius:12px;padding:30px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">' +
    '<h2 style="color:#1e293b;margin:0 0 8px">📋 EventOS 긴급 과업 알림</h2>' +
    '<p style="color:#64748b;margin:0 0 20px">' + todayStr + " · " + userName + "님 담당</p>" +
    (overdueCount > 0
      ? '<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px 16px;margin-bottom:16px;border-radius:0 8px 8px 0">' +
        '<strong style="color:#ef4444">⚠️ 마감 경과: ' + overdueCount + "건</strong></div>"
      : "") +
    (urgentCount > 0
      ? '<div style="background:#fffbeb;border-left:4px solid #f97316;padding:10px 16px;margin-bottom:16px;border-radius:0 8px 8px 0">' +
        '<strong style="color:#f97316">🔔 임박 과업: ' + urgentCount + "건</strong></div>"
      : "") +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">' +
    '<thead><tr style="background:#f1f5f9">' +
    '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e5e7eb">프로젝트</th>' +
    '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e5e7eb">구분</th>' +
    '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e5e7eb">과업</th>' +
    '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e5e7eb">마감일</th>' +
    '<th style="padding:10px 12px;text-align:center;font-weight:600;color:#475569;border-bottom:2px solid #e5e7eb">D-Day</th>' +
    "</tr></thead>" +
    "<tbody>" + overdueRows + urgentRows + "</tbody>" +
    "</table>" +
    '<p style="color:#94a3b8;font-size:12px;margin:20px 0 0;text-align:center">이 메일은 EventOS에서 매일 오전 10시에 자동 발송됩니다.</p>' +
    "</div>" +
    "</body></html>"
  );
}

/**
 * 중복 발송 방지: 오늘 이미 발송했는지 Drive 파일로 체크
 * GitHub Actions 크론 또는 포털 접속 시 호출
 */
function checkAndSendDailyEmails() {
  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var trackerFileName = "_dailyEmailTracker.json";
  var todayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  // 오늘 이미 발송했는지 확인
  var trackerFiles = root.getFilesByName(trackerFileName);
  var trackerFile = trackerFiles.hasNext() ? trackerFiles.next() : null;

  if (trackerFile) {
    try {
      var tracker = JSON.parse(trackerFile.getBlob().getDataAsString());
      if (tracker.lastSentDate === todayStr) {
        Logger.log("[EventOS] ℹ️ 오늘(" + todayStr + ") 이미 발송됨, 스킵");
        return { success: true, skipped: true, lastSentDate: todayStr, message: "Already sent today" };
      }
    } catch (e) { /* tracker 파싱 실패 시 재발송 */ }
  }

  // 이메일 발송
  sendDailyUrgentEmails();

  // 발송 기록 업데이트
  var trackerData = JSON.stringify({
    lastSentDate: todayStr,
    sentAt: new Date().toISOString(),
  });

  if (trackerFile) {
    trackerFile.setContent(trackerData);
  } else {
    root.createFile(trackerFileName, trackerData, "application/json");
  }

  Logger.log("[EventOS] ✅ 일일 이메일 발송 완료 (" + todayStr + ")");
  return { success: true, skipped: false, sentDate: todayStr, message: "Daily emails sent" };
}
