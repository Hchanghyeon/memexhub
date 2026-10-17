import type { T } from "./i18n";

export interface Check { id: string; ok: boolean; level?: "high"; n?: number }

/** Words for the server's security check ids, and where to fix them. */
export function checkText(t: T, c: Check): { text: string; fix?: string } {
  switch (c.id) {
    case "totp_on": return { text: t("Two-factor sign-in is on.", "2단계 인증이 켜져 있어요.") };
    case "totp_off": return { text: t("Two-factor sign-in is off.", "2단계 인증이 꺼져 있어요."), fix: "/security" };
    case "totp_off_public": return { text: t("The admin page is open to the internet without two-factor: turn it on now.", "관리 화면이 2단계 인증 없이 인터넷에 열려 있어요. 지금 켜세요."), fix: "/security" };
    case "admin_home": return { text: t("The admin page only opens on your home network.", "관리 화면은 집 네트워크에서만 열려요.") };
    case "admin_public": return { text: t("The admin page opens from the internet.", "관리 화면이 인터넷에서도 열려요.") };
    case "mcp_anthropic": return { text: t("Only Anthropic's servers may call memexhub.", "Anthropic 서버만 memexhub에 접속할 수 있어요.") };
    case "mcp_open": return { text: t("Any address may call memexhub (sign-in is still needed).", "아무 주소에서나 memexhub에 접속할 수 있어요(로그인은 필요)."), fix: "/security" };
    case "http_url": return { text: t("The public address uses http: use https.", "공개 주소가 http예요. https를 쓰세요.") };
    case "no_vault": return { text: t("No vault is connected yet.", "아직 볼트가 연결되지 않았어요."), fix: "/vault" };
    case "dav_devices": return { text: t(`Vault sync is on for ${c.n} device(s).`, `볼트 동기화를 기기 ${c.n}대가 써요.`) };
    case "dav_no_devices": return { text: t("Vault sync is on but no device has a token.", "볼트 동기화가 켜져 있지만 토큰이 있는 기기가 없어요."), fix: "/devices" };
    case "read_only": return { text: t("The vault is read-only for Claude.", "Claude에게 볼트는 읽기 전용이에요.") };
    case "backup_recent": return { text: t("A backup was made in the last two days.", "최근 이틀 안에 백업이 있어요.") };
    case "backup_old": return { text: t("No recent backup.", "최근 백업이 없어요."), fix: "/backups" };
    default: return { text: c.id };
  }
}
