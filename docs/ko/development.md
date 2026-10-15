# 개발

일하는 방식의 원본이에요. `CLAUDE.md`와 `CONTRIBUTING.md`는 이걸 요약해요.

## 브랜치

```
main      ← 릴리스만 (develop에서 PR + 태그)
develop   ← 통합. 기본 브랜치이자 모든 PR의 대상
  └─ feat/…  fix/…  docs/…  chore/…  refactor/…  test/…   ← develop에서 따요
```

- `main`, `develop`는 보호돼요: PR 필수, 필수 검사(`test`, `secrets`, `analyze`) 통과, 일직선 기록, 강제 푸시·삭제 금지, 대화 해결 필수.
- 브랜치 이름: `<종류>/<짧은-설명>` — `feat/wiki-lint`, `fix/oauth-redirect-match`

## 커밋

[Conventional Commits](https://www.conventionalcommits.org/):

```
<종류>(<범위>): <명령형 요약, 72자 이내>

<왜 바꿨나 (뻔하지 않을 때)>
```

종류: `feat` `fix` `docs` `refactor` `test` `chore` `perf` `ci` `build`. 범위는 폴더 이름: `core` `storage` `auth` `http` `admin` `wiki` `ledger` …

## 커밋 신원 — 개인 정보

저장소는 공개이고 기록은 영원히 남아요.

- **GitHub noreply 주소**(`<id>+<user>@users.noreply.github.com`)로 커밋하고 개인 메일은 절대 쓰지 않아요: 이 저장소에서 `git config user.email "<id>+<user>@users.noreply.github.com"`
- GitHub → Settings → Emails에서 **Keep my email addresses private**와 **Block command line pushes that expose my email**를 켜요.
- **GitHub의 머지 버튼은 누르지 않아요** (squash, 머지 커밋, rebase 모두). 세 방식 다 커밋을 새로 만들면서 머지한 계정의 **프로필 이름과 기본 메일**을 작성자나 커미터로 남겨요.
- 대신 **fast-forward로 머지**해요: PR이 초록불이면 PR 브랜치를 `develop`에 그대로 푸시해요 (`git push origin <브랜치>:develop`). 커밋을 새로 만들지 않아 noreply 신원이 그대로이고, GitHub이 PR을 자동으로 *Merged* 처리해요. 그래서 머지 전에 PR을 최신 `develop` 위로 rebase해 둬야 해요.

## 의존성

- Node: **현재 LTS** (CI, Dockerfile, `engines`를 맞춰요)
- 라이브러리: **최신 안정** 버전. Dependabot PR은 바로 검토해서 반영해요. 머지할 때 알려진 취약점이 없어야 해요 (`npm audit --omit=dev`, CI의 OSV-Scanner).
- 새 패키지보다 웹 표준과 Node 내장 기능을 먼저. 새 런타임 의존성은 PR에 이유를 적어요.

## PR

- PR 하나 = 일 하나. 크면 층별로 의존 순서대로 나눠요 (예: core → storage → auth → 입구 → 문서). **각 PR이 혼자서 빌드·시험을 통과**해야 해요.
- 코드 변경은 400줄 아래를 목표로 (문서·lockfile 제외). 넘으면 설명에 이유를.
- PR 템플릿: *무엇 · 왜 · 어떻게 시험했나 · 보안 체크*
- CI 통과 필수. 리뷰 의견은 반영하거나 이유를 달고 해결.
- **fast-forward**로 머지하고 (위 *커밋 신원*) 브랜치를 지워요.

## 푸시 전에

```bash
npm run typecheck && npm test
git diff --staged          # 직접 읽기: 비밀, 개인 정보, 실제 도메인·거래가 없는지
gitleaks protect --staged  # 설치돼 있으면
```

끝낸 기능은 문서의 상태 표시(✅ 🚧 📝)를 바꿔요.

## 머지 직후

새 커밋의 작성자·커미터를 확인해요 (`git log --format='%an <%ae> | %cn'`). 개인 정보가 보이면 커밋이 더 쌓이기 전에 멈추고 고쳐요.

## 릴리스

1. `develop` → `main` PR, 제목 `release: vX.Y.Z`
2. `main`을 릴리스 커밋으로 fast-forward 하고 `vX.Y.Z` 태그
3. 릴리스 노트에 **보안** 항목을 따로. 이미지는 태그에서 빌드·서명 (계획)

## 로컬

```bash
npm install
cp .env.example .env     # MEMEXHUB_SECRET, PUBLIC_URL
npm run dev
npm test
```
