# 건강 ✅

폰 건강 앱의 하루 수치가 연도별 **건강 노트**(`health/{year}.md`, 경로에 `{month}` 를 넣으면 달마다 한 노트; 관리 화면 → 기능 → Health)에 하루 한 줄로 들어가요. Claude는 `health_day(date)`로 하루를 읽어요.

```
- 10-14 (수) 😴 23:40–06:50 · 6시간 50분 (깊은 30분 · 렘 2시간 30분) · 깸 1번(20분) · 걸음 8,240 · 6.1 km · 안정 심박 58 · 🏃 달리기 32분 310 kcal
```

## 보내기: `POST /ingest/health`

헤더 `X-Ingest-Token`에 범위 `health` 기기 토큰. 본문은 두 가지 형식이에요.

**1. 단축어 / 아무 자동화**: 평평한 칸, 전부 선택:

| 칸 | 예 |
|---|---|
| `date` | `2026-10-14`: 활동 수치의 날짜 (없으면 어제) |
| 숫자 | `steps`, `distance_km`, `flights`, `active_kcal`, `exercise_min`, `stand_hours`, `resting_hr`, `avg_hr`, `walking_hr`, `hrv`, `spo2`, `respiratory`, `vo2max`, `weight`, `body_fat`, `mindful_min`, `water_ml`, `caffeine_mg`, `daylight_min`, `headphone_db`: 단위·쉼표가 섞여도 돼요. 그 밖의 `snake_case` 숫자도 20개까지 그대로 남겨요 |
| `sleep` | 한 줄에 샘플 하나 `시작|끝|값` (예: `2026-10-14 01:10|2026-10-14 01:40|깊은 수면`): 또는 목록 세 개 `sleep_start`, `sleep_end`, `sleep_value` |
| `workouts` | 한 줄에 하나 `종류|시작|시간|kcal` |

잠은 **깬 날짜**에 붙어요(지난밤 잠 = 그날 아침의 기록). 3시간 넘게 떨어진 샘플은 다른 잠이고, 가장 긴 게 지난밤이에요. 워치 없이 '침대'만 있으면 누워 있던 시간을 보여줘요.

**2. Health Auto Export 앱**: REST API 자동화 본문 `{ "data": { "metrics": [...], "workouts": [...] } }`. 하루에 여러 값이면 합치거나 평균 내고, 단위(마일, kJ, lb, 0–1 비율)를 바꾸고, 수면 요약·조각 둘 다 돼요.

같은 날짜를 다시 보내면 그 날짜 값만 **바뀌어요**. iOS 단축어, Health Auto Export, 그 밖에 JSON을 POST할 수 있는 것 무엇이든(Android: Health Connect 내보내기 앱, Tasker).
