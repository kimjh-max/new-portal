# Google Apps Script 세팅 가이드

## 1단계: Apps Script 프로젝트 생성

1. https://script.google.com 접속 (Google 로그인)
2. **새 프로젝트** 클릭
3. 프로젝트 이름을 **"EventOS Drive Sync"** 로 변경

## 2단계: 코드 붙여넣기

1. 기본 생성된 `Code.gs`의 내용을 **전부 삭제**
2. `Code.gs` 파일의 내용을 **전체 복사**하여 붙여넣기
3. **Ctrl+S** (또는 Cmd+S)로 저장

## 3단계: 배포

1. 상단 메뉴 **배포 > 새 배포** 클릭
2. **유형 선택** (톱니바퀴 아이콘) > **웹 앱** 선택
3. 설정:
   - **설명**: EventOS Drive Sync
   - **다음 사용자 인증으로 실행**: **나** (본인 계정)
   - **액세스 권한이 있는 사용자**: **모든 사용자**
4. **배포** 클릭
5. Google 계정 권한 승인 (Drive 접근 허용)
6. **웹 앱 URL** 복사 (예: `https://script.google.com/macros/s/AKf.../exec`)

## 4단계: EventOS 포털에 URL 설정

`EventOS.html` 파일을 열고 상단의 `DRIVE_CONFIG` 부분을 찾아서:

```javascript
const DRIVE_CONFIG = {
  GAS_URL: "",  // ← 여기에 복사한 URL 붙여넣기
```

예시:
```javascript
  GAS_URL: "https://script.google.com/macros/s/AKfycbw.../exec",
```

## 5단계: 테스트

1. EventOS 포털을 브라우저에서 열기
2. 상단 바에 **"✅ 동기화됨"** 표시 확인
3. 프로젝트 수정 후 Google Drive 폴더 확인

## 문제 해결

- **"Drive 미연결"** 표시: `DRIVE_CONFIG.GAS_URL`이 비어있는지 확인
- **"동기화 실패"** 표시: Apps Script 배포 URL이 정확한지 확인
- **권한 오류**: Apps Script에서 Google Drive 접근 권한을 승인했는지 확인
- **코드 수정 후**: Apps Script에서 **배포 > 배포 관리 > 새 버전** 발행 필요
