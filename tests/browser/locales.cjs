const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH }
            : {}),
    });
    try {
        const page = await browser.newPage();
        const base = process.env.TEST_URL || "http://127.0.0.1:8000";
        await page.goto(base);
        await page.locator("#language-select").selectOption("ar");
        await page.waitForFunction(
            () => document.documentElement.dir === "rtl",
        );
        for (const route of ["/", "/login", "/register"]) {
            await page.goto(base + route);
            assert.equal(await page.locator("html").getAttribute("lang"), "ar");
            for (const width of [1440, 390]) {
                await page.setViewportSize({ width, height: 900 });
                assert.equal(
                    await page.evaluate(
                        () => document.documentElement.scrollWidth > innerWidth,
                    ),
                    false,
                    `${route}: Arabic fits width ${width}`,
                );
                await page.screenshot({
                    path: path.resolve(
                        __dirname,
                        "../../storage/app/qa",
                        `arabic-${route.replaceAll("/", "") || "landing"}-${width}.png`,
                    ),
                    fullPage: true,
                });
            }
        }
        console.log(
            "PASS: persisted Arabic landing/login/register, desktop/mobile layouts",
        );
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
