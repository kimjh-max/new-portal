import { useState, useEffect, useRef } from "react";
// ── 더미 데이터 ──────────────────────────────────────────────────────────────
const PROJECTS = [
  {
    id: 1,
    name: "2025 한국전자전 KES",
    client: "삼성전자",
    producer: "김지현",
    status: "진행중",
    progress: 68,
    budget: 85000000,
    cost: 61200000,
    startDate: "2025-09-01",
    eventDate: "2025-10-15",
    endDate: "2025-10-18",
    kickoff: true,
    tags: ["전시", "B2B"],
    thumbnail: null,
    checklist: [
      { id: 1, category: "기획", item: "킥오프 미팅", done: true, amount: 0 },
      { id: 2, category: "기획", item: "과업지시서 수령", done: true, amount: 0 },
      { id: 3, category: "기획", item: "운영계획안 작성", done: true, amount: 500000 },
      { id: 4, category: "공간", item: "부스 설계 도면", done: true, amount: 3200000 },
      { id: 5, category: "공간", item: "시공업체 선정", done: true, amount: 15000000 },
      { id: 6, category: "영상", item: "메인 영상 제작", done: false, amount: 8000000 },
      { id: 7, category: "영상", item: "홍보 콘텐츠", done: false, amount: 2500000 },
      { id: 8, category: "인력", item: "스태프 섭외", done: true, amount: 4800000 },
      { id: 9, category: "인력", item: "MC/진행자", done: false, amount: 1500000 },
      { id: 10, category: "장비", item: "음향 장비 임대", done: false, amount: 3200000 },
      { id: 11, category: "장비", item: "조명 설치", done: false, amount: 2800000 },
      { id: 12, category: "홍보", item: "초청장 발송", done: true, amount: 800000 },
    ],
    logs: [
      { date: "2025-09-01", author: "김지현", type: "auto", content: "프로젝트 킥오프 미팅 완료. 참석자: 삼성전자 마케팅팀 5명, 내부 3명" },
      { date: "2025-09-05", author: "김지현", type: "auto", content: "과업지시서 수령 및 검토 완료. 주요 요구사항 정리됨" },
      { date: "2025-09-10", author: "김지현", type: "comment", content: "부스 설계 1차 시안 클라이언트 피드백 반영 필요. 색상 톤 변경 요청 있음" },
      { date: "2025-09-15", author: "시스템", type: "auto", content: "시공업체 계약 체결 완료 (㈜이벤트빌더)" },
      { date: "2025-09-20", author: "김지현", type: "comment", content: "스태프 15명 확정. 유니폼 사이즈 취합 중" },
    ],
    gantt: [
      { task: "기획 및 과업정의", start: 0, duration: 14, color: "#6366f1" },
      { task: "운영계획안 작성", start: 7, duration: 10, color: "#8b5cf6" },
      { task: "부스 설계/시공", start: 14, duration: 28, color: "#06b6d4" },
      { task: "영상 콘텐츠 제작", start: 21, duration: 21, color: "#f59e0b" },
      { task: "인력 섭외/교육", start: 28, duration: 14, color: "#10b981" },
      { task: "장비 설치/리허설", start: 40, duration: 5, color: "#ef4444" },
      { task: "행사 운영", start: 45, duration: 4, color: "#ec4899" },
    ],
  },
  {
    id: 2,
    name: "롯데백화점 팝업스토어",
    client: "롯데백화점",
    producer: "박서준",
    status: "준비중",
    progress: 32,
    budget: 42000000,
    cost: 13440000,
    startDate: "2025-10-01",
    eventDate: "2025-11-20",
    endDate: "2025-11-27",
    kickoff: true,
    tags: ["팝업", "리테일"],
    thumbnail: null,
    checklist: [
      { id: 1, category: "기획", item: "킥오프 미팅", done: true, amount: 0 },
      { id: 2, category: "기획", item: "과업지시서 수령", done: true, amount: 0 },
      { id: 3, category: "기획", item: "운영계획안 작성", done: false, amount: 500000 },
      { id: 4, category: "공간", item: "공간 레이아웃", done: true, amount: 1200000 },
      { id: 5, category: "영상", item: "프로모션 영상", done: false, amount: 3500000 },
      { id: 6, category: "인력", item: "판촉 도우미", done: false, amount: 2800000 },
    ],
    logs: [
      { date: "2025-10-01", author: "박서준", type: "auto", content: "킥오프 미팅 완료" },
      { date: "2025-10-08", author: "박서준", type: "comment", content: "공간 레이아웃 1차 확정. 롯데 VM팀 승인 대기 중" },
    ],
    gantt: [
      { task: "기획/과업정의", start: 0, duration: 10, color: "#6366f1" },
      { task: "공간 디자인", start: 8, duration: 15, color: "#06b6d4" },
      { task: "제작/시공", start: 20, duration: 14, color: "#f59e0b" },
      { task: "행사 운영", start: 34, duration: 8, color: "#ec4899" },
    ],
  },
  {
    id: 3,
    name: "현대차 신차 발표회",
    client: "현대자동차",
    producer: "이수민",
    status: "완료",
    progress: 100,
    budget: 120000000,
    cost: 108000000,
    startDate: "2025-07-01",
    eventDate: "2025-08-20",
    endDate: "2025-08-20",
    kickoff: true,
    tags: ["발표회", "자동차"],
    thumbnail: null,
    checklist: [
      { id: 1, category: "기획", item: "킥오프 미팅", done: true, amount: 0 },
      { id: 2, category: "공간", item: "무대 설계", done: true, amount: 18000000 },
      { id: 3, category: "영상", item: "신차 론칭 영상", done: true, amount: 22000000 },
      { id: 4, category: "인력", item: "사회자/모델", done: true, amount: 8000000 },
    ],
    logs: [
      { date: "2025-08-20", author: "시스템", type: "auto", content: "행사 완료. 참석자 약 450명" },
      { date: "2025-08-22", author: "이수민", type: "comment", content: "결과보고서 초안 작성 완료. 클라이언트 검토 요청" },
    ],
    gantt: [],
  },
];
const CHECKLIST_CATEGORIES = ["기획", "공간", "영상", "인력", "장비", "홍보", "케이터링", "기타"];
// ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────
const fmt = (n) => n?.toLocaleString("ko-KR") + "원";
const profitRate = (budget, cost) => (((budget - cost) / budget) * 100).toFixed(1);
const statusColor = { 진행중: "#6366f1", 준비중: "#f59e0b", 완료: "#10b981", 보류: "#6b7280" };
// ── AI 요약 생성 (Anthropic API) ───────────────────────────────────────────────
async function generateAISummary(project) {
  const prompt = `다음 이벤트 프로젝트 정보를 3문장으로 간결하게 요약해줘. 진행 상황, 주요 완료 항목, 남은 과제를 포함해서.
프로젝트명: ${project.name}
클라이언트: ${project.client}
진행률: ${project.progress}%
예산: ${fmt(project.budget)}
예상비용: ${fmt(project.cost)}
수익률: ${profitRate(project.budget, project.cost)}%
체크리스트 완료: ${project.checklist.filter(c => c.done).length}/${project.checklist.length}
최근 업무로그: ${project.logs.slice(-2).map(l => l.content).join(" / ")}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || "요약 생성 실패";
  } catch {
    return "AI 요약을 불러오는 중 오류가 발생했습니다.";
  }
}
// ── 자동 견적서 생성 ───────────────────────────────────────────────────────────
function generateQuote(project) {
  const items = project.checklist.filter((c) => c.amount > 0);
  const total = items.reduce((s, c) => s + c.amount, 0);
  const margin = project.budget - total;
  return { items, total, margin, rate: ((margin / project.budget) * 100).toFixed(1) };
}

// NOTE: This is the reference example provided by the user.
// The full component tree continues with TopBar, StatCard, ProjectCard,
// GanttChart, ChecklistQuote, WorkLog, AISummaryPanel, ReportPanel,
// ProjectDetail, Dashboard, and the main EventOS export default component.
// See EventOS.html for the fully enhanced, responsive implementation.
