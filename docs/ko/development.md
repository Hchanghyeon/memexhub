# 개발

## 브랜치

```
main      ← 릴리스만 (develop에서 PR + 태그)
develop   ← 통합. PR 기본 대상
  └─ feat/… fix/… docs/… chore/…   ← develop에서 따서 develop으로 PR
```

- `main`, `develop` 둘 다 보호: PR 필수, CI 통과 필수, 강제 푸시 금지
- PR은 작고 한 가지 일만. squash 또는 rebase 머지
- 릴리스: `develop` → `main` PR, `vX.Y.Z` 태그, 릴리스 노트에 *보안* 항목 따로

## 로컬

```bash
npm install
npm run dev          # MEMEXHUB_SECRET, PUBLIC_URL 필요 (.env.example)
npm test
npm run typecheck
```

## 푸시 전에

- `npm run typecheck && npm test`
- diff에 개인 정보나 비밀이 없는지 읽기, `gitleaks protect --staged`
- 끝낸 기능은 문서의 상태 표시(✅ 🚧 📝) 갱신
