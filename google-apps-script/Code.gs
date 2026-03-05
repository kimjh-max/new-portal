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

    // 📧 매일 아침 자동 이메일 체크 & 발송 (GitHub Actions 크론에서 호출)
    if (action === "sendDailyEmail") {
      var result = checkAndSendDailyEmails();
      return jsonResponse(result);
    }

    // 📧 강제 이메일 발송 (중복 체크 무시)
    if (action === "forceDailyEmail") {
      sendDailyUrgentEmails();
      return jsonResponse({ ok: true, message: "Daily email force sent" });
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

    // 📧 이메일 발송 (긴급 과업 알림)
    if (action === "sendEmail") {
      const to = body.to || "";
      const subject = body.subject || "[EventOS] 알림";
      const htmlBody = body.htmlBody || "";

      if (!to) return jsonResponse({ error: "수신자 이메일(to)이 필요합니다" });

      MailApp.sendEmail({
        to: to,
        subject: subject,
        htmlBody: htmlBody,
        name: "EventOS 알림 시스템",
      });

      Logger.log("[EventOS] 📧 이메일 발송: " + to + " | " + subject);
      return jsonResponse({ ok: true, to: to, sentAt: new Date().toISOString() });
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

// ═══ 매일 아침 자동 긴급 과업 이메일 ═══════════════════════════════════════

/**
 * 서버사이드: 매일 아침 10시(KST) 자동 실행
 * Drive에서 프로젝트 데이터를 읽고, 긴급 과업이 있는 담당자에게 이메일 발송
 */
function sendDailyUrgentEmails() {
  try {
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);

    // 1. 사용자 목록 로드 (이메일 포함)
    const appDataFile = findFile(root, SYSTEM_DATA_FILE);
    if (!appDataFile) {
      Logger.log("[EventOS] _appData.json not found");
      return;
    }
    const appData = JSON.parse(appDataFile.getBlob().getDataAsString());
    const users = appData.users || [];

    // 이메일이 있는 사용자만
    const usersWithEmail = users.filter(function(u) { return u.email && u.email.trim(); });
    if (usersWithEmail.length === 0) {
      Logger.log("[EventOS] No users with email found");
      return;
    }

    // 2. 프로젝트 데이터 로드
    const allProjects = [];
    const folders = root.getFolders();
    while (folders.hasNext()) {
      const folder = folders.next();
      if (folder.getName().startsWith("_")) continue;
      const projFile = findFile(folder, PROJECT_DATA_FILE);
      if (projFile) {
        try {
          const projData = JSON.parse(projFile.getBlob().getDataAsString());
          if (projData.project) allProjects.push(projData.project);
        } catch (e) { /* skip */ }
      }
    }

    // 3. 오늘 날짜 기준 3일 이내 긴급 과업 수집
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const todayStr = Utilities.formatDate(today, "Asia/Seoul", "yyyy-MM-dd");
    const threeStr = Utilities.formatDate(threeDaysLater, "Asia/Seoul", "yyyy-MM-dd");

    // 담당자별 긴급 과업 그룹핑
    const tasksByUser = {};

    allProjects.forEach(function(project) {
      (project.gantt || []).forEach(function(ganttItem) {
        (ganttItem.subtasks || []).forEach(function(subtask) {
          if (subtask.done) return;
          if (!subtask.endDate) return;
          if (!subtask.assignee) return;

          // endDate가 오늘 이전(지남) 또는 3일 이내
          if (subtask.endDate <= threeStr) {
            var assignee = subtask.assignee;
            if (!tasksByUser[assignee]) tasksByUser[assignee] = [];

            // D-day 계산
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

    // 4. 각 사용자에게 이메일 발송
    var sentCount = 0;

    usersWithEmail.forEach(function(user) {
      var userName = user.name;
      var userEmail = user.email.trim();
      var tasks = tasksByUser[userName];

      if (!tasks || tasks.length === 0) return;

      // 마감일 순 정렬
      tasks.sort(function(a, b) { return a.endDate.localeCompare(b.endDate); });

      // HTML 이메일 생성
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
  var trackerFile = findFile(root, "_dailyEmailTracker.json");
  var todayStr = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  // 오늘 이미 발송했는지 확인
  if (trackerFile) {
    try {
      var tracker = JSON.parse(trackerFile.getBlob().getDataAsString());
      if (tracker.lastSentDate === todayStr) {
        Logger.log("[EventOS] ℹ️ 오늘(" + todayStr + ") 이미 발송됨, 스킵");
        return { ok: true, skipped: true, lastSentDate: todayStr, message: "Already sent today" };
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
    root.createFile("_dailyEmailTracker.json", trackerData, "application/json");
  }

  Logger.log("[EventOS] ✅ 일일 이메일 발송 완료 (" + todayStr + ")");
  return { ok: true, skipped: false, sentDate: todayStr, message: "Daily emails sent" };
}
