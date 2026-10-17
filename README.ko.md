# memexhub

**내 AI를 위한 두 번째 뇌.** 내 노트와 생활 기록을 한곳에 모아 정리하고, Claude 같은 AI가 커넥터 하나로 꺼내 쓰게 해 주는 셀프호스팅 서버예요.

[English](README.md) · [문서](docs/ko/README.md) · [보안](SECURITY.md)

> ⚠️ 초기 단계(v0.1)예요. Anthropic, Obsidian과 관계없는 개인 프로젝트예요.

## 설치하고 10분 뒤에 되는 것

- **Claude가 내 노트를 알아요.** "지난달 정리한 회의 노트 찾아 줘", "이 글 내 위키에 정리해 줘"처럼 물어보면 내 볼트(마크다운 폴더)를 찾고 읽고 써요.
- **폰 기록이 알아서 쌓여요.** 카드 결제 문자, 다녀온 곳, 건강, 어느 앱에서든 "공유"한 글이 들어와요. 폰 설정은 QR 한 번이에요.
- **매일 밤 일지가 써져요.** Claude 루틴이 "오늘 어디서 누구와 뭘 했고 얼마 썼는지"를 일정·위치·결제를 합쳐 정리하고, 실제로 한 할 일에는 체크해요. 루틴 프롬프트는 관리 화면에서 복사해요.

memexhub는 에이전트가 아니고 모델도 돌리지 않아요. 생각은 Claude가 하고, memexhub는 Claude가 꺼내 쓰는 **기억**이에요. 기억은 내 서버에 있어요.

## 설치

**필요한 것:** Docker가 되는 서버(NAS, 집 PC, VPS), 그리고 밖에서 들어오는 **HTTPS 주소**. Claude가 인터넷 쪽에서 접속하기 때문이에요. 시놀로지 역방향 프록시, Caddy, Cloudflare Tunnel 중 아무거나 돼요.

```bash
mkdir memexhub && cd memexhub
curl -fsSLO https://raw.githubusercontent.com/Hchanghyeon/memexhub/main/compose.example.yml && mv compose.example.yml compose.yml
printf 'MEMEXHUB_SECRET=%s\nPUBLIC_URL=https://memex.example.com\nTZ=Asia/Seoul\n' "$(openssl rand -base64 48)" > .env && chmod 600 .env
docker compose up -d && docker compose logs memexhub | grep -i "setup code"
```

1. `PUBLIC_URL`을 내 HTTPS 주소로 바꾸고, 그 주소를 서버의 8787 포트로 연결해요. 폰 기록용으로 8790도 연결해요. 자세히: [설치 안내](docs/ko/install.md)
2. 관리 화면을 열고 로그에 나온 **설치 코드**를 넣어요. 관리 화면은 안전하게 서버 안(`127.0.0.1:8791`)에서만 열려요. 다른 PC에서는 `ssh -L 8791:127.0.0.1:8791 내서버` 후 `http://localhost:8791`.
3. 3단계 처음 설정을 따라가요: 언어·시간 → 볼트 → Claude 앱 연결. Claude가 연결되면 화면이 알려 줘요.
4. 그다음 **기기**에서 폰을 설정하고, **Claude 앱** 화면의 루틴 프롬프트를 Claude 앱 루틴에 붙여 넣어요.

**서버가 없다면:** [Cloudflare 버튼 설치](docs/ko/cloudflare.md) · **홈 어시스턴트·시놀로지·Railway:** [앱스토어](docs/ko/app-stores.md) · **개발:** `npm install && npm run dev`

## 어떻게 정리하나: LLM Wiki

볼트는 Andrej Karpathy가 소개한 **LLM Wiki** 방식으로 쌓여요.

- **원본:** 내가 모은 글, 메모, 기록. 한 번 저장하면 고치지 않아요.
- **위키:** Claude가 원본을 읽고 쓰는 주제 페이지. 주장마다 원본을 인용해요.
- **규칙:** 이 위키를 어떻게 쓸지 Claude에게 알려 주는 노트.

AI는 실수도 기억에 써 넣을 수 있어서, 일을 나눠요. **판단은 Claude**, 링크·인용·형식처럼 **정답이 하나인 것은 코드**가 검사해요. **확인은 내가** 해요: AI가 쓴 페이지는 내가 확인하기 전까지 초안이에요. 자세히: [위키 엔진](docs/ko/wiki-engine.md)

## 보안

인터넷에 열려 있고, 코드가 공개돼 있고, AI가 읽는 내용에 속을 수 있다고 전제하고 만들었어요.

- 밖으로 데이터를 보내는 도구가 없어요 (메일 발송, 임의 URL 요청 없음)
- Claude 연결은 OAuth 2.1, 관리 화면은 내부망 + 2단계 인증, 비밀값은 암호화 저장
- 규칙 노트는 보호돼서 도구로 바꿀 수 없어요

전체 위협 모델: [보안](docs/ko/security.md). 취약점은 비공개로 신고해 주세요: [SECURITY.md](SECURITY.md)

## 더 보기

- [되는 기능 전체](docs/ko/README.md#지금-되는-것): 연결 20여 종, 도구, 진행 상황
- [Claude 연동](docs/ko/claude-integration.md) · [구조](docs/ko/architecture.md) · [기여하기](CONTRIBUTING.md)

이름은 1945년 Vannevar Bush가 상상한 개인용 기억 기계 *Memex*에서 왔어요.

## 라이선스

MIT
