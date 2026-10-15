# 메일 ✅

IMAP으로 메일함을 **읽기만** 해요. Claude(`mail_*` 도구), 하루 요약(개수만), 결제 메일([레시피](recipes.md#메일-))에 써요. 계정 여러 개를 같이 쓸 수 있어요.

## 연결

관리 화면 → 연결 → *Mail (IMAP)*: 이름(예: `personal`), 서비스, 아이디.

| 서비스 | 비밀번호 | 참고 |
|---|---|---|
| 카카오 | 계정 비밀번호, 2단계 인증을 켰다면 앱 비밀번호 | 카카오메일 설정에서 IMAP 사용 |
| 네이버 | **앱 비밀번호** (네이버 ID → 보안) | 네이버 메일 설정에서 IMAP 사용 |
| Gmail | **앱 비밀번호** (Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호) | |
| Outlook | 계정이 허용하면 앱 비밀번호 | 회사 계정은 IMAP이 막혀 있기도 해요 |
| 직접 입력 | IMAP 호스트와 포트. TLS 필수 (암호화 없는 IMAP은 내부망에서만) | |

## 안전

- **구조상 읽기 전용**: `CAPABILITY LOGIN LIST EXAMINE UID SEARCH UID FETCH LOGOUT NOOP` 명령만 보낼 수 있어요. 메일함은 `EXAMINE`으로 열고 본문은 `BODY.PEEK`으로 가져와서 읽음 표시·이동·삭제가 절대 안 일어나요. **보내기 도구는 없어요.**
- Claude에게 주는 메일 내용은 **신뢰할 수 없는 내용**으로 표시하고, 링크는 `[link]`로 바꾸고, 첨부파일은 열지 않고(이름만), 길이를 제한해요.
- 비밀번호는 암호화해서 저장하고 다시 보여주지 않아요.

## 도구

| 도구 | 하는 일 |
|---|---|
| `mail_folders(account?)` | 메일함 목록 |
| `mail_search(account?, folder, since, until?, query?, from?)` | 찾은 메일: 날짜, 보낸 사람, 제목 |
| `mail_read(account?, folder, uid)` | 메일 하나를 글로 (8000자까지) |
| `mail_day(account?, date?)` | 하루 일지용: 받은·보낸 메일은 앞부분, 나머지 메일함은 제목만 |
