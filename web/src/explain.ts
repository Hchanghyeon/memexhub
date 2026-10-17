import type { T } from "./i18n";

/**
 * Server and connection messages are English and technical ("https required", "fetch failed").
 * This turns the common ones into a sentence that says what to do; the original stays in brackets.
 */
const RULES: [RegExp, (m: RegExpMatchArray) => [string, string]][] = [
  [/https required/i, () => ["Only https addresses are allowed. For a home address (http://, 192.168.x.x), edit the connection and tick “on my home network”.", "https 주소만 쓸 수 있어요. 집 안 주소(http://, 192.168.x.x)라면 연결을 수정해서 “집 네트워크 안에 있어요”를 체크하세요."]],
  [/private network address not allowed/i, () => ["That is a home-network address. Edit the connection and tick “on my home network”.", "집 네트워크 안의 주소예요. 연결을 수정해서 “집 네트워크 안에 있어요”를 체크하세요."]],
  [/host not allowed: (\S+)/i, (m) => [`The address ${m[1]} is not allowed. Check the address in the connection.`, `${m[1]} 주소는 허용되지 않아요. 연결의 주소를 다시 확인하세요.`]],
  [/credentials in URL/i, () => ["Do not put a username or password in the address; use the fields for them.", "주소 안에 아이디·비밀번호를 넣지 말고, 아래 칸에 따로 넣으세요."]],
  [/redirects are not followed/i, () => ["The address forwards somewhere else. Enter the final address.", "주소가 다른 곳으로 넘어가요(리디렉션). 최종 주소를 그대로 넣으세요."]],
  [/response too large/i, () => ["The service sent back too much at once.", "서비스가 한 번에 너무 많은 내용을 보냈어요."]],
  [/refused the token/i, () => ["Home Assistant refused the token. Make a new long-lived access token and enter it.", "홈 어시스턴트가 토큰을 거절했어요. 장기 액세스 토큰을 새로 만들어 넣으세요."]],
  [/sign-in expired or revoked/i, () => ["The sign-in expired. Press “Sign in again”.", "로그인이 만료됐어요. “다시 로그인”을 누르세요."]],
  [/not signed in/i, () => ["Not signed in yet. Press the sign-in button.", "아직 로그인하지 않았어요. 로그인 버튼을 누르세요."]],
  [/sign-?in refused|authenticat|unauthori[sz]ed|\b401\b|\b403\b|invalid credentials|login failed/i, () => ["Sign-in was refused. Check the username and password (an app password where the service needs one).", "로그인이 거절됐어요. 아이디와 비밀번호(필요한 곳은 앱 비밀번호)를 확인하세요."]],
  [/certificate|self[- ]signed|CERT_/i, () => ["The server's certificate is not trusted (self-signed?). Use an address with a valid https certificate.", "서버 인증서를 믿을 수 없어요(자체 서명 등). 올바른 https 인증서가 있는 주소를 쓰세요."]],
  [/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|timed? ?out|AbortError|network/i, () => ["Could not reach the server. Check the address and port, and that the server is on.", "서버에 닿지 않아요. 주소와 포트, 서버가 켜져 있는지 확인하세요."]],
  [/\b404\b|not found/i, () => ["Nothing at that address. Check the address.", "그 주소에 아무것도 없어요. 주소를 확인하세요."]],
];

export function explain(t: T, message: string | null | undefined): string {
  const msg = (message ?? "").trim();
  if (!msg) return t("Unknown error.", "알 수 없는 오류예요.");
  for (const [re, say] of RULES) {
    const m = msg.match(re);
    if (m) return `${t(...say(m))} (${msg})`;
  }
  return msg;
}
