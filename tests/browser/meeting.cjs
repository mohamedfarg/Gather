const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

module.exports = (async () => {
    const root = path.resolve(__dirname, "../..");
    const artifacts = path.join(root, "storage/app/qa");
    fs.mkdirSync(artifacts, { recursive: true });
    const base = process.env.TEST_URL || "http://127.0.0.1:8000";
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH }
            : {}),
        args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ],
    });
    const hostContext = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        permissions: ["camera", "microphone"],
    });
    const guestContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ["camera", "microphone"],
    });
    if (process.env.PUSHER_TEST_FIXTURE === "1") {
        for (const context of [hostContext, guestContext]) await require("./pusher-fixture.cjs").install(context);
    }
    for (const context of [hostContext, guestContext])
        await context.addInitScript(() => {
            window.__testPeers = [];
            const Native = window.RTCPeerConnection;
            window.RTCPeerConnection = new Proxy(Native, {
                construct(target, args) {
                    const pc = new target(...args);
                    window.__testPeers.push(pc);
                    return pc;
                },
            });
        });
    const host = await hostContext.newPage(),
        guest = await guestContext.newPage();
    const errors = [],
        external = [];
    const email = `qa-${Date.now()}@example.test`;
    for (const page of [host, guest]) {
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (msg) => {
            if (["warning", "error"].includes(msg.type()))
                console.log("Browser:", msg.type(), msg.text());
        });
        page.on("response", (res) => {
            if (res.status() >= 400)
                console.log("HTTP:", res.status(), res.url());
        });
        page.on("request", (req) => {
            if (/^https?:/.test(req.url()) && !req.url().startsWith(base + "/"))
                external.push(req.url());
        });
    }
    try {
        assert.equal((await host.goto(base)).status(), 200);
        await host.screenshot({
            path: path.join(artifacts, "landing-desktop.png"),
            fullPage: true,
        });
        await host.setViewportSize({ width: 390, height: 844 });
        assert.equal(
            await host.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            "Landing must fit mobile",
        );
        await host.screenshot({
            path: path.join(artifacts, "landing-mobile.png"),
            fullPage: true,
        });
        await host.setViewportSize({ width: 1440, height: 1050 });
        await host.goto(base + "/register");
        await host.locator("#name").fill("Alex Morgan");
        await host.locator("#email").fill(email);
        await host.locator("#password").fill("qa-strong-password");
        await host.locator("#password_confirmation").fill("qa-strong-password");
        await host.getByRole("button", { name: "Create account" }).click();
        await host.waitForURL("**/dashboard");
        await host
            .getByRole("button", { name: "Schedule a meeting", exact: true })
            .click();
        await host.locator("#title").fill("Product & design catch-up");
        await host
            .locator("#description")
            .fill("A little space to share ideas and plan the week.");
        await host
            .locator(
                "#schedule-form button[type=submit], #schedule-form button",
            )
            .last()
            .click();
        await host.waitForURL("**/dashboard");
        await host
            .getByRole("button", { name: "Schedule a meeting", exact: true })
            .click();
        await host.locator("#title").fill("Friday team sync");
        await host.locator("#schedule-form button").last().click();
        await host.waitForURL("**/dashboard");
        await host.screenshot({
            path: path.join(artifacts, "dashboard-desktop.png"),
            fullPage: true,
        });
        await host.setViewportSize({ width: 390, height: 844 });
        assert.equal(
            await host.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            "Dashboard must fit mobile",
        );
        await host.screenshot({
            path: path.join(artifacts, "dashboard-mobile.png"),
            fullPage: true,
        });
        await host.setViewportSize({ width: 1440, height: 1000 });
        await host
            .getByRole("link", { name: "Start", exact: true })
            .first()
            .click();
        await host.waitForURL("**/m/**");
        const room = host.url();
        await host.locator("#preview-mic").click();
        await host.locator("#preview-camera").click();
        await host.waitForFunction(
            () =>
                document.querySelector("#preview-video").videoWidth > 0 &&
                !document.querySelector("#preview-camera").disabled,
        );
        await host.screenshot({ path: path.join(artifacts, "lobby.png") });
        await host.locator("#join-button").click();
        await host.locator("#call").waitFor({ state: "visible" });
        await guest.goto(room);
        await guest.locator("#display-name").fill("Sam Rivera");
        await guest.locator("#preview-mic").click();
        await guest.locator("#preview-camera").click();
        await guest.locator("#join-button").click();
        await guest.locator("#waiting").waitFor({ state: "visible" });
        await host.locator("#toggle-people").click();
        await host.getByRole("button", { name: "Admit", exact: true }).click();
        await guest.locator("#call").waitFor({ state: "visible" });
        await host.waitForFunction(
            () =>
                document.querySelectorAll(".peer-status[hidden]").length === 1,
            {},
            { timeout: 30000 },
        );
        await guest.waitForFunction(
            () =>
                document.querySelectorAll(".peer-status[hidden]").length === 1,
            {},
            { timeout: 30000 },
        );
        for (const page of [host, guest]) {
            await page.waitForFunction(
                () => {
                    const v = document.querySelector(
                        ".video-tile:not(.local-tile) video",
                    );
                    return (
                        v?.srcObject?.getAudioTracks().length === 1 &&
                        v?.videoWidth > 0
                    );
                },
                {},
                { timeout: 20000 },
            );
        }
        await host.locator("#toggle-chat").click();
        await host
            .locator("#chat-input")
            .fill("Welcome, Sam! <script>window.injected=true</script>");
        await host.locator("#chat-form button").click();
        await guest
            .getByText("Welcome, Sam! <script>window.injected=true</script>", {
                exact: true,
            })
            .waitFor();
        assert.equal(await guest.evaluate(() => window.injected), undefined);
        await guest.locator("#chat-input").fill("Happy to be here.");
        await guest.locator("#chat-form button").click();
        await host.getByText("Happy to be here.", { exact: true }).waitFor();
        await guest.locator("#raise-hand").click();
        await host.getByText("Sam Rivera ✋", { exact: false }).waitFor();
        await guest.waitForFunction(
            () =>
                document
                    .querySelector("#toggle-mic")
                    .classList.contains("speaking"),
            {},
            { timeout: 20000 },
        );
        await guest.locator("#reaction-toggle").click();
        await guest.locator('[data-reaction="👏"]').click();
        await host
            .locator(".floating-reaction")
            .filter({ hasText: "Sam Rivera" })
            .waitFor();
        await host.locator("#toggle-people").click();
        await host.locator("#mute-all").click();
        await guest.waitForFunction(
            () => document.querySelector("#toggle-mic").disabled,
        );
        assert.equal(await guest.locator("#muted-by-host").isVisible(), true);
        await host
            .getByRole("button", { name: "Allow to speak", exact: true })
            .click();
        await guest.waitForFunction(
            () => !document.querySelector("#toggle-mic").disabled,
        );
        assert.equal(
            await guest.locator("#toggle-mic").getAttribute("aria-label"),
            "Turn microphone on",
        );
        await guest.locator("#toggle-mic").click();
        await guest.locator("#language-select").selectOption("ar");
        await guest.waitForFunction(
            () => document.documentElement.dir === "rtl",
        );
        assert.equal(
            await guest.locator("#local-name").innerText(),
            "Sam Rivera",
        );
        assert.equal(
            await guest.getByText("Happy to be here.", { exact: true }).count(),
            1,
        );
        assert.equal(
            await guest.evaluate(() => window.__testPeers[0].connectionState),
            "connected",
        );
        await guest.waitForTimeout(1500);
        await guest.screenshot({
            path: path.join(artifacts, "meeting-arabic.png"),
        });
        await guest.locator("#language-select").selectOption("en");
        await guest.waitForFunction(
            () => document.documentElement.dir === "ltr",
        );
        await host.evaluate(() => {
            window.__originalStats = window.__testPeers.map((pc) =>
                pc.getStats.bind(pc),
            );
            window.__testPeers.forEach(
                (pc) =>
                    (pc.getStats = async () =>
                        new Map([
                            [
                                "bad",
                                {
                                    type: "remote-inbound-rtp",
                                    roundTripTime: 1,
                                },
                            ],
                        ])),
            );
        });
        await host
            .locator("#connection-warning")
            .waitFor({ state: "visible", timeout: 15000 });
        await host.evaluate(() =>
            window.__testPeers.forEach(
                (pc, i) => (pc.getStats = window.__originalStats[i]),
            ),
        );
        await host
            .locator("#connection-warning")
            .waitFor({ state: "hidden", timeout: 15000 });
        await host.screenshot({
            path: path.join(artifacts, "meeting-desktop.png"),
        });
        // Exercise replaceTrack with a generated display stream; the OS chooser itself is manual.
        await host.evaluate(() => {
            navigator.mediaDevices.getDisplayMedia = async () => {
                const c = document.createElement("canvas");
                c.width = 640;
                c.height = 360;
                const ctx = c.getContext("2d");
                ctx.fillStyle = "#176b57";
                ctx.fillRect(0, 0, 640, 360);
                ctx.fillStyle = "#def09b";
                ctx.font = "40px sans-serif";
                ctx.fillText("Shared screen test", 50, 180);
                return c.captureStream(10);
            };
        });
        await host.locator("#share-screen").click();
        await guest.waitForFunction(() =>
            document
                .querySelector(".video-tile:not(.local-tile)")
                .classList.contains("sharing"),
        );
        await host.locator("#share-screen").click();
        await guest.waitForFunction(
            () =>
                !document
                    .querySelector(".video-tile:not(.local-tile)")
                    .classList.contains("sharing"),
        );
        // Mute the recording host: audible output must therefore come from the remote guest.
        await host.locator("#toggle-mic").click();
        await host.locator("#record-button").click();
        await host.locator("#start-recording").click();
        await host.waitForTimeout(2500);
        const downloadWait = host.waitForEvent("download");
        await host.locator("#record-button").click();
        const download = await downloadWait;
        const recording = path.join(artifacts, download.suggestedFilename());
        await download.saveAs(recording);
        assert.ok(fs.statSync(recording).size > 100);
        const recordedAudio = await host.evaluate(async (base64) => {
            const context = new AudioContext();
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const audio = await context.decodeAudioData(bytes.buffer);
            const samples = audio.getChannelData(0);
            const rms = Math.sqrt(
                samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
            );
            await context.close();
            return { rms, duration: audio.duration };
        }, fs.readFileSync(recording).toString("base64"));
        assert.ok(
            recordedAudio.rms > 0.001,
            `Remote audio must be audible in recording: ${JSON.stringify(recordedAudio)}`,
        );
        await host.locator("#toggle-mic").click();
        await guest.setViewportSize({ width: 390, height: 844 });
        await guest.locator("#close-panel").click();
        assert.equal(
            await guest.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            "Room must fit mobile",
        );
        await guest.screenshot({
            path: path.join(artifacts, "meeting-mobile.png"),
        });
        await host.locator("#toggle-people").click();
        await host.locator("#lock-room").click();
        await host.waitForFunction(
            () =>
                document.querySelector("#room-status").textContent ===
                "Meeting locked",
        );
        const thirdContext = await browser.newContext();
        if (process.env.PUSHER_TEST_FIXTURE === "1") await require("./pusher-fixture.cjs").install(thirdContext);
        const third = await thirdContext.newPage();
        await third.goto(room);
        await third.locator("#display-name").fill("Late guest");
        await third.locator("#join-button").click();
        await third
            .getByText("The host has locked this meeting.", { exact: true })
            .waitFor();
        await host.locator("#lock-room").click();
        await host.waitForFunction(
            () =>
                document.querySelector("#room-status").textContent !==
                "Meeting locked",
        );
        await third.locator("#join-button").click();
        await third.locator("#waiting").waitFor({ state: "visible" });
        await host.getByRole("button", { name: "Admit", exact: true }).click();
        await third.locator("#call").waitFor({ state: "visible" });
        await host.locator("#allow-all").click();
        await third.waitForFunction(
            () => !document.querySelector("#toggle-mic").disabled,
        );
        await third.locator("#toggle-mic").click();
        await third.locator("#toggle-camera").click();
        for (const page of [host, guest, third]) {
            await page.waitForFunction(
                () =>
                    document.querySelectorAll(".peer-status[hidden]").length ===
                    2,
                {},
                { timeout: 30000 },
            );
            await page.waitForFunction(
                () =>
                    Array.from(
                        document.querySelectorAll(
                            ".video-tile:not(.local-tile) video",
                        ),
                    ).every(
                        (v) =>
                            v.videoWidth > 0 &&
                            v.srcObject?.getAudioTracks().length === 1,
                    ),
                {},
                { timeout: 20000 },
            );
        }
        await host.screenshot({
            path: path.join(artifacts, "meeting-three-people.png"),
        });
        host.on("dialog", (dialog) => dialog.accept());
        await host.getByRole("button", { name: "Remove Sam Rivera" }).click();
        await guest.locator("#exit-screen").waitFor({ state: "visible" });
        await host.locator("#end-room").click();
        await host.locator("#exit-screen").waitFor({ state: "visible" });
        await third.locator("#exit-screen").waitFor({ state: "visible" });
        await thirdContext.close();
        assert.deepEqual(errors, [], "No browser script errors");
        assert.deepEqual(external, [], "No external runtime requests");
        console.log(
            JSON.stringify(
                {
                    status: "PASS",
                    checks: [
                        "registration",
                        "scheduling",
                        "desktop/mobile layouts",
                        "waiting room",
                        "host admission",
                        "two-peer WebRTC audio/video",
                        "three-person mesh and enabling media after entry",
                        "chat escaping",
                        "raise hand",
                        "speaking animation and emoji propagation",
                        "host mute all and permission to speak",
                        "live Arabic RTL switch preserves media and user content",
                        "weak connection warning and recovery",
                        "screen track replacement",
                        "recording contains audible remote voice while host is muted",
                        "lock",
                        "remove",
                        "end",
                    ],
                    externalRequests: external.length,
                    artifacts,
                },
                null,
                2,
            ),
        );
    } catch (error) {
        await host.screenshot({
            path: path.join(artifacts, "failure-host.png"),
        });
        await guest.screenshot({
            path: path.join(artifacts, "failure-guest.png"),
        });
        console.log("Host:", await host.locator("body").innerText());
        console.log("Guest:", await guest.locator("body").innerText());
        for (const page of [host, guest])
            console.log(
                "Peers:",
                await page.evaluate(() =>
                    window.__testPeers?.map((pc) => ({
                        state: pc.connectionState,
                        ice: pc.iceConnectionState,
                        signaling: pc.signalingState,
                        transceivers: pc.getTransceivers().map((t) => ({
                            kind: t.receiver.track.kind,
                            direction: t.direction,
                            current: t.currentDirection,
                            sending: t.sender.track?.readyState,
                        })),
                    })),
                ),
            );
        throw error;
    } finally {
        await browser.close();
        // Remove only this run’s generated account and its meeting data.
        execFileSync(
            process.env.PHP_PATH || "php",
            [
                "artisan",
                "tinker",
                "--execute",
                `App\\Models\\User::where('email', '${email}')->delete();`,
            ],
            { cwd: root, stdio: "pipe" },
        );
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
