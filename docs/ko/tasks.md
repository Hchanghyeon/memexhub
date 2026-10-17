# 할 일 ✅

할 일 목록(Google Tasks)을 Claude 도구로 써요. 계정 여러 개("personal", "work")를 같이 쓸 수 있고, 모든 도구에 `account`를 넘겨요.

## Google 계정 연결

1. Google Cloud Console → 프로젝트 → **API 및 서비스**: **Google Tasks API** 사용 설정
2. **OAuth 동의 화면**: 외부(Workspace면 내부), 테스트 사용자에 나를 추가
3. **사용자 인증 정보 → OAuth 클라이언트 만들기 → 웹 애플리케이션**. 승인된 리디렉션 URI: `PUBLIC_URL/oauth/google/callback` (관리 화면에 정확한 값이 보여요)
4. memexhub 관리 화면 → 연결 → *Google Tasks*: 이름(예: `personal`), 클라이언트 ID, 클라이언트 보안 비밀 → 저장
5. 연결 옆 **Sign in with Google**을 누르고 계정을 고르면 끝. 계정을 더 붙이려면 4–5를 반복해요 (같은 클라이언트를 같이 써도 돼요)

보안: 인가 코드 + PKCE, 10분짜리 일회용 `state`, 최소 권한(`tasks`, 어느 계정인지 보여주려고 `openid email`). 리프레시 토큰은 암호화해서 저장하고 보여주지 않아요. Google 계정 → 보안 → 타사 액세스에서 언제든 끊을 수 있어요.

## 도구

| 도구 | 하는 일 |
|---|---|
| `tasks_accounts` | 연결된 계정 |
| `tasklists(account)` | 계정의 목록들 |
| `tasks_list(account, tasklist?, show_completed?, limit?)` | 할 일, 안 한 것부터 마감 순 |
| `task_add(account, title, notes?, due?, tasklist?)` | 추가 (마감은 날짜만: Google Tasks는 시각을 안 저장해요) |
| `task_update(account, task_id, title?, notes?, due?)` | 바꾸기, `due: "none"`이면 마감 지움 |
| `task_complete(account, task_id, undo?)` | 완료 / 되돌리기 |
| `task_delete(account, task_id)` | **위험: 기본은 숨김**, 설정에서 켜야 보여요 |
