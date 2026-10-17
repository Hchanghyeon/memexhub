import { expect, test, type Page } from "@playwright/test";

const USER = "owner";
const PASSWORD = "a-long-test-password";
const PAGES: [string, RegExp][] = [
  ["/", /개요/], ["/notes", /노트/], ["/vault", /볼트/], ["/claude", /Claude에서 memexhub 쓰기/], ["/devices", /기기/], ["/connections", /연결/],
  ["/features", /기능/], ["/recipes", /메시지/], ["/activity", /활동/], ["/security", /보안/], ["/backups", /백업/], ["/map", /지도/],
];

/** Fails the test on any uncaught page error or console error. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

async function signIn(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel("아이디").fill(USER);
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "개요" })).toBeVisible();
}

test("a wrong password is refused with a plain message", async ({ page }) => {
  await page.goto("/admin/");
  await page.getByLabel("아이디").fill(USER);
  await page.getByLabel("비밀번호").fill("wrong-password-123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("아이디, 비밀번호 또는 코드가 맞지 않아요.")).toBeVisible();
});

test("every screen opens without errors", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  for (const [path, title] of PAGES) {
    await page.goto(`/admin${path === "/" ? "/" : path}`);
    await expect(page.getByRole("heading", { level: 1, name: title }), path).toBeVisible();
    await expect(page.locator("[aria-busy=true]"), path).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("moving between screens with the sidebar keeps working", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop sidebar");
  const errors = watchErrors(page);
  await signIn(page);
  const nav = page.getByRole("navigation");
  for (const name of ["노트", "볼트", "Claude 앱", "기기", "연결", "기능", "메시지", "활동", "보안", "백업", "개요"]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 }), name).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("a setting is saved and still set after a reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/security");
  const sw = page.getByRole("switch", { name: "Anthropic 서버만" });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(page.getByText("저장했어요.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Anthropic 서버만" })).toBeChecked();
  await page.getByRole("switch", { name: "Anthropic 서버만" }).click();
  await expect(page.getByRole("switch", { name: "Anthropic 서버만" })).not.toBeChecked();
});

test("a device token is shown once after it is created", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/devices");
  const name = `E2E ${test.info().project.name}`;
  await page.getByLabel("이름").fill(name);
  await page.getByRole("button", { name: "토큰 만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "새 토큰" })).toBeVisible();
  await expect(page.getByText(/^mxi_/).first()).toBeVisible();
  await page.getByRole("button", { name: "다 했어요" }).click();
  await expect(page.getByRole("heading", { name: "새 토큰" })).toHaveCount(0);
  await expect(page.getByText(name)).toBeVisible();
});

test("on a phone the menu slides in and closes after choosing a screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  await signIn(page);
  await page.getByRole("button", { name: "메뉴" }).click();
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "보안" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "보안" })).toBeVisible();
});

test("notes: browse folders, read a note, follow a wiki link, search", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/notes");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Garden plan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garden plan" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Tomato" })).toBeVisible();
  await expect(page.getByText("💡 Water")).toBeVisible();
  await expect(page.getByText("status")).toBeVisible();
  await page.getByRole("link", { name: "Seeds" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Seeds" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/notes\/Seeds\.md$/);
  await page.reload(); // a note address opens directly too
  await expect(page.getByRole("heading", { level: 1, name: "Seeds" })).toBeVisible();
  await page.goto("/admin/notes");
  await page.getByPlaceholder("모든 노트에서 찾기").fill("seed list");
  await page.keyboard.press("Enter");
  await expect(page.getByText("노트 1개")).toBeVisible();
  expect(errors).toEqual([]);
});

test("notes: pictures show in place, PDFs open by link", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/notes/Attachments.md");
  const img = page.getByRole("img", { name: "pixel.png" });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  const pdf = page.getByRole("link", { name: /Scan result\.pdf/ }).first();
  await expect(pdf).toHaveAttribute("href", "/admin/api/vault/file?path=files%2FScan%20result.pdf");
  const r = await page.request.get("/admin/api/vault/file?path=files%2FScan%20result.pdf");
  expect(r.headers()["content-type"]).toBe("application/pdf");
  await page.goto("/admin/notes");
  await page.getByRole("button", { name: "files" }).click();
  await expect(page.getByRole("link", { name: "pixel.png" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("map: a day's route and stays", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/map");
  await page.getByLabel("날짜").fill("2026-01-15");
  await expect(page.getByRole("heading", { name: "머문 곳" })).toBeVisible();
  await expect(page.getByRole("region", { name: "map" })).toBeVisible();
  await expect(page.locator(".leaflet-overlay-pane path").first()).toBeAttached();
  await expect(page.getByRole("button", { name: "지도 바탕 켜기" })).toBeVisible();
  await page.getByRole("button", { name: "지도에서 보기" }).first().click();
  await page.getByRole("button", { name: "전날" }).click();
  await expect(page.getByText("이날은 위치 기록이 없어요.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("map: the phone menu covers the map, zoom buttons included", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the slide-in menu is phone only");
  await signIn(page);
  await page.goto("/admin/map");
  await page.getByLabel("날짜").fill("2026-01-15");
  const zoom = page.locator(".leaflet-control-zoom-in");
  await expect(zoom).toBeVisible();
  await page.getByRole("button", { name: "메뉴" }).click();
  const box = (await zoom.boundingBox())!;
  // Leaflet layers use z-index 400–1000; the map keeps them inside its own stacking context.
  const top = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".leaflet-container"), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(top).toBe(false);
});

test("first-run setup: three steps, waits for Claude, can finish later", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/start");
  await expect(page.getByText("3단계 중 1단계")).toBeVisible();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByText("3단계 중 2단계")).toBeVisible();
  await page.getByRole("button", { name: "그대로 두고 계속" }).click();
  await expect(page.getByText("Claude 앱이 로그인하기를 기다리는 중…")).toBeVisible();
  await page.getByRole("button", { name: /나중에 할게요/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "개요" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("connections: short service names; what it needs and the easier path show when opened", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/connections");
  const google = page.getByRole("button", { name: /Google 캘린더/ });
  await expect(google.getByText("고급")).toBeVisible();
  await expect(page.getByText(/Claude 앱의 Google Calendar 커넥터가 더 쉬워요/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Last.fm", exact: true })).toBeVisible();
  await google.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Claude 앱의 Google Calendar 커넥터가 더 쉬워요/)).toBeVisible();
  await expect(dialog.getByText(/Google Cloud의 OAuth 클라이언트/)).toBeVisible();
});
test("devices: one QR sets up OwnTracks with a fresh location token", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/devices");
  await page.getByRole("button", { name: "설정 QR 만들기" }).click();
  await expect(page.getByRole("img", { name: "OwnTracks 설정 QR 코드" })).toBeVisible();
  const href = await page.getByRole("link", { name: "OwnTracks에서 열기" }).getAttribute("href");
  expect(href).toMatch(/^owntracks:\/\/\/config\?inline=/);
  const conf = JSON.parse(Buffer.from(decodeURIComponent(href!.split("inline=")[1]!), "base64").toString("utf8"));
  expect(conf).toMatchObject({ _type: "configuration", mode: 3, auth: true });
  expect(conf.url).toMatch(/\/ingest\/owntracks$/);
  // The token in the QR really sends location (HTTP Basic, as OwnTracks does).
  const r = await page.request.post(conf.url.replace(/^https?:\/\/[^/]+/, ""), {
    headers: { authorization: `Basic ${Buffer.from(`${conf.username}:${conf.password}`).toString("base64")}`, "content-type": "application/json" },
    data: { _type: "location", lat: 37.5, lon: 127, tst: Math.floor(Date.now() / 1000) },
  });
  expect(r.status()).toBe(200);
  await page.getByRole("button", { name: "단축어용 토큰 만들기" }).click();
  await expect(page.getByText(/\/ingest\/message$/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("notes: a page Claude wrote is a draft until you confirm it", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/notes/wiki/Tomatoes.md");
  await expect(page.getByText("Claude가 쓰고 아직 확인하지 않은 페이지예요.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "확인했어요" }).click();
  await expect(page.getByText("확인됨", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다시 검토 필요" }).click();
  await expect(page.getByRole("button", { name: "확인했어요" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("notes: see an earlier version and put it back", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/admin/notes/Seeds.md");
  await page.getByRole("button", { name: "이전 판" }).click();
  await page.getByRole("button", { name: /첫 기록/ }).click();
  await expect(page.getByRole("dialog").getByText("Sample seed list.")).toBeVisible();
  page.once("dialog", (d) => void d.accept()); // "Put this version back?"
  await page.getByRole("button", { name: "이 판으로 되돌리기" }).click();
  await expect(page.locator("article").getByText("Sample seed list.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("claude: ready-made routines with their prompts", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/claude");
  await expect(page.getByText("하루 일지 · 매일 밤, 예: 23:00")).toBeVisible();
  await page.getByText("프롬프트 보기").first().click();
  await expect(page.getByText(/day_summary 를 부르세요/)).toBeVisible();
  await expect(page.getByRole("button", { name: "복사" }).nth(1)).toBeVisible();
});

test("messages: plain words, a recipe collection to switch on, a guide, JSON under Advanced", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/recipes");
  await expect(page.getByRole("heading", { name: "메시지", level: 1 })).toBeVisible();
  await expect(page.getByText("모두 읽었어요. 확인할 메시지가 없어요.")).toBeVisible();
  await expect(page.getByText(/알아서 읽는 곳 \(\d+\)/)).toBeVisible();
  await expect(page.getByText("현대카드 문자")).toBeVisible();
  await expect(page.getByText("레시피란?")).toBeVisible();
  await page.getByText("예시와 항목 설명").click();
  await page.getByRole("button", { name: "이 예시로 시작하기" }).click();
  await expect(page.getByLabel("레시피 (JSON)")).toHaveValue(/custom\.samplepay\.sms/);
  await page.getByLabel("레시피 (JSON)").fill("");
  await expect(page.getByLabel("레시피 (JSON)")).toBeHidden();
  await page.getByText("레시피 직접 쓰기 (JSON)").click();
  await expect(page.getByLabel("레시피 (JSON)")).toBeVisible();
});
