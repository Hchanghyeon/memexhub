import { expect, test, type Page } from "@playwright/test";

const USER = "owner";
const PASSWORD = "a-long-test-password";
const PAGES: [string, RegExp][] = [
  ["/", /개요/], ["/vault", /볼트/], ["/claude", /Claude에서 memexhub 쓰기/], ["/devices", /기기/], ["/connections", /연결/],
  ["/features", /기능/], ["/recipes", /레시피·대기함/], ["/activity", /활동/], ["/security", /보안/], ["/backups", /백업/],
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
  for (const name of ["볼트", "Claude 앱", "기기", "연결", "기능", "레시피·대기함", "활동", "보안", "백업", "개요"]) {
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
  await page.getByRole("button", { name: "토큰 만들기" }).click();
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
