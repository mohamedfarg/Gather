// A local Pusher protocol fixture. The browser still runs the real Pusher.js
// client, and Laravel signs/authenticates its subscriptions and REST events.
const http = require("node:http");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const key = "local-e2e-key", secret = "local-e2e-secret", appId = "local-e2e";
const sockets = new Set();
let sequence = 0, signedEvents = 0, authorizedSubscriptions = 0, rejectedRequests = 0;
const signature = (text) => crypto.createHmac("sha256", secret).update(text).digest("hex");
const send = (socket, event, channel, data) => socket.route.send(JSON.stringify({
    event, ...(channel ? { channel } : {}), data: JSON.stringify(data),
}));
const roomSockets = (channel) => [...sockets].filter((socket) => socket.channel === channel);

async function install(context) {
    await context.routeWebSocket(/^wss:\/\/ws-[^.]+\.pusher\.com\/app\//, (route) => {
        const socket = { route, id: `1000.${++sequence}`, channel: null, user: null };
        sockets.add(socket);
        send(socket, "pusher:connection_established", null, { socket_id: socket.id, activity_timeout: 120 });
        route.onMessage((raw) => {
            const message = JSON.parse(raw.toString());
            if (message.event === "pusher:ping") return send(socket, "pusher:pong", null, {});
            if (message.event !== "pusher:subscribe") return;
            const { channel, auth, channel_data } = message.data;
            assert.equal(auth, `${key}:${signature(`${socket.id}:${channel}:${channel_data}`)}`);
            assert.ok(channel.startsWith("presence-meeting."));
            authorizedSubscriptions++;
            const existing = roomSockets(channel);
            socket.channel = channel;
            socket.user = JSON.parse(channel_data).user_id;
            const hash = Object.fromEntries(roomSockets(channel).map((member) => [member.user, {}]));
            send(socket, "pusher_internal:subscription_succeeded", channel, {
                presence: { ids: Object.keys(hash), hash, count: Object.keys(hash).length },
            });
            for (const peer of existing) {
                send(peer, "pusher_internal:member_added", channel, { user_id: socket.user, user_info: {} });
            }
        });
        route.onClose(() => {
            sockets.delete(socket);
            if (socket.channel) for (const peer of roomSockets(socket.channel)) {
                send(peer, "pusher_internal:member_removed", socket.channel, { user_id: socket.user });
            }
        });
    });
}

async function start() {
    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, "http://localhost");
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = Buffer.concat(chunks).toString();
            assert.equal(url.searchParams.get("auth_key"), key);
            const actual = url.searchParams.get("auth_signature");
            url.searchParams.delete("auth_signature");
            url.searchParams.sort();
            assert.equal(actual, signature(`${request.method}\n${url.pathname}\n${url.searchParams}`));
            response.setHeader("Content-Type", "application/json");
            if (request.method === "POST" && url.pathname === `/apps/${appId}/events`) {
                assert.equal(url.searchParams.get("body_md5"), crypto.createHash("md5").update(body).digest("hex"));
                const event = JSON.parse(body);
                signedEvents++;
                for (const channel of event.channels || [event.channel]) for (const socket of roomSockets(channel)) {
                    send(socket, event.name, channel, JSON.parse(event.data));
                }
                response.end("{}");
            } else {
                const match = url.pathname.match(/^\/apps\/local-e2e\/channels\/([^/]+)\/users$/);
                assert.ok(match, "Unexpected Pusher REST endpoint");
                const channel = decodeURIComponent(match[1]);
                response.end(JSON.stringify({ users: [...new Set(roomSockets(channel).map((s) => s.user))].map((id) => ({ id })) }));
            }
        } catch (error) {
            rejectedRequests++;
            console.error("Pusher test fixture rejected a request:", error.message);
            response.statusCode = 400;
            response.end(JSON.stringify({ error: error.message }));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, port: server.address().port };
}

module.exports = { install, start, key, secret, appId, counts: () => ({ signedEvents, authorizedSubscriptions, rejectedRequests }) };
