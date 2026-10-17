# 다른 설정에서 옮겨오기

예전 서버나 스크립트를 쓰던 기록을 잃지 않고 memexhub로 넘어올 수 있어요.

1. **설치**: 예전 것 옆에 memexhub를 띄우고([설치](install.md)) 마법사에서 **같은 볼트**를 연결해요.
2. **기록 가져오기**: 관리 화면 → **Import**
   - **결제**: JSON Lines, 한 줄에 기록 하나. 칸: `time`(ISO, 필수), `merchant`, `amount`(`₩12,500`, `-₩8,000`, `USD 1.00`), `card`, `name`, `place`, `item`, `kind`, `transit`, `online`, `late`, `source`. 이미 계산된 값은 그대로 둬요. `"skipped": "merged"`와 `target`(결제 시각)이 있는 줄은 그 결제에 품목 이름을 붙여요. 이미 있는 기록(같은 시각·금액·가맹점)은 건너뛰니까 두 번 가져와도 괜찮아요.
   - **건강**: JSON `{ "YYYY-MM-DD": { "metrics": {...}, "sleep": {...}, "workouts": [...] } }` ([건강](health.md))
   - **기기 토큰**: 자동화마다 쓰던 토큰을 그대로 유지(해시로 저장)해서 주소만 바꾸면 돼요.
3. **확인**: 다시 그려진 노트(결제, 돈, 건강)를 봐요. 가져온 기록으로 새로 그려져요.
4. **전환**: 자동화의 주소를 바꿔요(원문 → `POST /ingest/message`에 `"channel": "sms"`, 정리된 결제 → `/ingest/transaction`, 건강 → `/ingest/health`). 연결에서 위치·메일·할 일을 붙이고, Claude 커넥터를 추가해요.
5. **며칠 같이 돌려 보고** 비교한 뒤 예전 것을 꺼요. 전환 전 [백업](configuration-and-storage.md#백업-)을 하나 남겨 두세요.
