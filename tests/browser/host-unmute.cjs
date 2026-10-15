const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

module.exports = (async () => {
    const root = path.resolve(__dirname, "../..");
    const email = `mic-${Date.now()}@example.test`;
    const base = process.env.TEST_URL || "http://127.0.0.1:8080";
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH }
            : {}),
        args: [
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ],
    });
    // Permission starts undecided; grant only after the camera-off page loads.
    const context = await browser.newContext();
    if (process.env.PUSHER_TEST_FIXTURE === "1") {
        await require("./pusher-fixture.cjs").install(context);
    }
    await context.addInitScript(() => {
        if (!navigator.mediaDevices) return;
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.__capturedStreams = [];
        window.__nativeCapture = async (constraints) => {
            const stream = await capture(constraints);
            window.__capturedStreams.push(stream);
            return stream;
        };
        navigator.mediaDevices.getUserMedia = window.__nativeCapture;
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
        if (request.url().startsWith(base + "/") && /\/(poll|heartbeat)(\?|$)/.test(request.url())) requests.push(request.url());
    });

    try {
        await page.goto(base + "/register");
        await page.locator("#name").fill("Mic Host");
        await page.locator("#email").fill(email);
        await page.locator("#password").fill("qa-strong-password");
        await page.locator("#password_confirmation").fill("qa-strong-password");
        await page.getByRole("button", { name: "Create account" }).click();
        await page.waitForURL("**/dashboard");
        await page.getByRole("button", { name: "New meeting" }).click();
        await page.waitForURL("**/m/**");
        await page.waitForLoadState("load", { timeout: 3000 });
        assert.deepEqual(await page.evaluate(() => ({
            ready: document.readyState,
            previewEmpty: document.querySelector("#preview-video").srcObject === null,
            localEmpty: document.querySelector("#local-video").srcObject === null,
        })), { ready: "complete", previewEmpty: true, localEmpty: true });
        await page.locator("#join-button").click();
        await page.locator("#call").waitFor({ state: "visible" });
        if (process.env.PUSHER_TEST_FIXTURE === "1") {
            await page.waitForFunction(() => Pusher.instances[0]?.channel("presence-meeting." + ROOM.code)?.subscribed);
        }
        await context.grantPermissions(["microphone"]);
        await page.locator("#toggle-mic").click();
        await page.waitForFunction(
            () => document.querySelector("#toggle-mic").getAttribute("aria-pressed") === "true" && !document.querySelector("#toggle-mic").disabled,
        );
        const state = await page.evaluate(async () => {
            const response = await fetch(window.ROOM.base + "/poll");
            const data = await response.json();
            return { host: !!data.me.is_host, audio: !!data.me.audio, locked: !!data.me.audio_locked };
        });
        assert.deepEqual(state, { host: true, audio: true, locked: false });

        // A rejected permission must keep the control usable for another try.
        await page.locator("#toggle-mic").click();
        await page.waitForFunction(() => !document.querySelector("#toggle-mic").disabled);
        await page.evaluate(() => {
            window.__capturedStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
            navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
        });
        await page.locator("#toggle-mic").click();
        await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("Permission was declined") && !document.querySelector("#toggle-mic").disabled);

        // Ignoring a browser prompt must not disable Unmute forever. Late
        // permission approval must stop the abandoned stream, not turn it on.
        await page.clock.install();
        await page.evaluate(() => {
            window.__lateStops = 0;
            navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { window.__resolveCapture = resolve; });
        });
        await page.locator("#toggle-mic").click();
        await page.waitForFunction(() => typeof window.__resolveCapture === "function");
        await page.clock.fastForward(15001);
        await page.waitForFunction(() => !document.querySelector("#toggle-mic").disabled && document.querySelector("#toast").textContent.includes("Allow microphone access"));
        await page.evaluate(() => window.__resolveCapture({ getTracks: () => [{ stop: () => window.__lateStops++ }] }));
        await page.waitForFunction(() => window.__lateStops === 1);
        assert.equal(await page.locator("#toggle-mic").getAttribute("aria-pressed"), "false");
        await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__nativeCapture; });
        await page.locator("#toggle-mic").click();
        await page.waitForFunction(() => document.querySelector("#toggle-mic").getAttribute("aria-pressed") === "true" && !document.querySelector("#toggle-mic").disabled);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const beforeIdle = requests.length;
        await page.clock.fastForward(26000);
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(requests.length, beforeIdle, "Idle meeting must not poll or send an HTTP heartbeat");
        assert.equal(await page.evaluate(() => document.readyState), "complete");
        await page.screenshot({ path: path.join(root, "storage/app/qa/host-unmute-complete.png") });
        assert.deepEqual(errors, []);
        console.log("PASS page load completes with devices off; host unmutes; denied/ignored permission recovers; late capture stops; idle sends no polls or heartbeat");
    } finally {
        await browser.close();
        execFileSync(process.env.PHP_PATH || "php", ["artisan", "tinker", "--execute", `App\\Models\\User::where('email', '${email}')->delete();`], { cwd: root, stdio: "pipe" });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
