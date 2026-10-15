const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const fixture = require("./pusher-fixture.cjs");

(async () => {
    const root = path.resolve(__dirname, "../..");
    const artifacts = path.join(root, "storage/app/qa");
    fs.mkdirSync(artifacts, { recursive: true });
    const run = `pusher-e2e-${Date.now()}`;
    const database = path.join(artifacts, `${run}.sqlite`);
    const { server, port } = await fixture.start();
    fs.writeFileSync(database, "");
    const appPort = Number(process.env.E2E_PORT || 8011);
    const base = `http://127.0.0.1:${appPort}`;
    const env = {
        ...process.env, APP_ENV: "local", APP_DEBUG: "false", APP_URL: base,
        APP_KEY: `base64:${Buffer.alloc(32, 7).toString("base64")}`,
        APP_CONFIG_CACHE: path.join(artifacts, `${run}-config.php`),
        APP_ROUTES_CACHE: path.join(artifacts, `${run}-routes.php`),
        DB_CONNECTION: "sqlite", DB_DATABASE: database, DB_URL: "",
        SESSION_DRIVER: "database", CACHE_STORE: "array", QUEUE_CONNECTION: "sync",
        BROADCAST_CONNECTION: "pusher", PUSHER_APP_ID: fixture.appId,
        PUSHER_APP_KEY: fixture.key, PUSHER_APP_SECRET: fixture.secret, PUSHER_APP_CLUSTER: "mt1",
        PUSHER_HOST: "127.0.0.1", PUSHER_PORT: String(port), PUSHER_SCHEME: "http",
        PUSHER_TEST_FIXTURE: "1", TEST_URL: base,
    };
    let phpServer;
    try {
        const migrate = spawnSync(process.env.PHP_PATH || "php", ["artisan", "migrate", "--force"], { cwd: root, env, encoding: "utf8" });
        if (migrate.status !== 0) throw new Error(`Test database migration failed: ${migrate.stderr || migrate.stdout}`);
        phpServer = spawn(process.env.PHP_PATH || "php", ["-S", `127.0.0.1:${appPort}`, path.join(root, "vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php")], { cwd: path.join(root, "public"), env, stdio: "ignore" });
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            try { ready = (await fetch(`${base}/up`)).ok; } catch {}
            if (ready) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ready) throw new Error("Local test server did not start");
        Object.assign(process.env, env);
        await require("./host-unmute.cjs");
        if (process.exitCode) throw new Error("Host media regression failed");
        if (process.env.E2E_MEDIA_ONLY !== "1") {
            await require("./meeting.cjs");
            if (process.exitCode) throw new Error("Meeting integration failed");
        }
        const counts = fixture.counts();
        if (counts.rejectedRequests) throw new Error("Pusher fixture rejected server requests");
        if (!counts.signedEvents || !counts.authorizedSubscriptions) throw new Error("Pusher protocol was not exercised");
        console.log("PASS real Pusher.js protocol, signed server events and session channel authorization:", counts);
    } finally {
        if (phpServer) {
            phpServer.kill();
            await new Promise((resolve) => phpServer.once("exit", resolve));
        }
        await new Promise((resolve) => server.close(resolve));
        for (const suffix of ["", "-wal", "-shm"]) {
            try { fs.unlinkSync(database + suffix); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
