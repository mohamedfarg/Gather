/* Self-hosted Laravel signaling + native browser WebRTC. No external services. */
$(function () {
    const cfg = window.ROOM,
        api = (path, method, data) => Gather.api(cfg.base + path, method, data);
    const peers = new Map();
    let me = null,
        iceServers = [],
        members = [],
        camera = null,
        microphone = null,
        screen = null;
    let audioOn = false,
        videoOn = false,
        hand = false,
        sharing = false,
        joined = false,
        stopped = false;
    let cursor = 0,
        messageCursor = 0,
        pollTimer,
        elapsedTimer,
        startedAt,
        recorder = null,
        recordingStream = null,
        failures = 0;
    let activityCursor = 0,
        audioContext = null,
        recordingMixer = null,
        recordingBusy = false;
    const meters = new Map();
    let weakSamples = 0,
        goodSamples = 0,
        qualityBusy = false;
    const t = (key, values) => (window.Gather.t ? Gather.t(key, values) : key);
    function audioInputs() {
        const inputs = [{ track: microphone, allowed: audioOn }];
        for (const [id, peer] of peers) {
            const member = members.find((p) => p.id === id);
            for (const track of peer.stream.getAudioTracks())
                inputs.push({
                    track,
                    allowed: !!member?.audio && !member?.audio_locked,
                });
        }
        return inputs;
    }
    async function resumeAudio() {
        if (!audioContext)
            audioContext = new (
                window.AudioContext || window.webkitAudioContext
            )();
        if (audioContext.state === "suspended") await audioContext.resume();
    }
    const meterTimer = setInterval(() => {
        if (stopped || !audioContext) return;
        const live = new Set();
        const inputs = audioInputs();
        recordingMixer?.sync(inputs);
        for (const input of inputs) {
            const track = input.track;
            if (!track || track.readyState !== "live") continue;
            live.add(track.id);
            if (!meters.has(track.id))
                meters.set(
                    track.id,
                    new GatherMedia.Meter(track, audioContext),
                );
            const speaking =
                input.allowed && meters.get(track.id).level() > 0.012;
            if (track === microphone) {
                $("#local-tile, #preview-mic, #toggle-mic").toggleClass(
                    "speaking",
                    speaking,
                );
                $("#local-speaking").prop("hidden", !speaking);
            } else {
                for (const [id, peer] of peers)
                    if (peer.stream.getAudioTracks().includes(track))
                        $(tileFor(id)).toggleClass("speaking", speaking);
            }
        }
        if (!audioOn)
            $("#local-tile, #preview-mic, #toggle-mic").removeClass("speaking");
        for (const [id, meter] of meters)
            if (!live.has(id)) {
                meter.close();
                meters.delete(id);
            }
    }, 100);
    function warnConnection(
        show,
        key = "Weak connection. Audio or video may be interrupted.",
    ) {
        $("#connection-warning")
            .prop("hidden", !show)
            .attr("title", t(key))
            .attr("aria-label", t(key));
        $("#connection-warning-text").text(t(key));
    }
    const qualityTimer = setInterval(async () => {
        if (stopped || !joined || qualityBusy) return;
        qualityBusy = true;
        let poor = !navigator.onLine || failures >= 2;
        try {
            for (const peer of peers.values()) {
                poor ||= ["disconnected", "failed"].includes(
                    peer.pc.connectionState,
                );
                const result = GatherMedia.quality(
                    await peer.pc.getStats(),
                    peer.previousStats,
                );
                peer.previousStats = result.current;
                poor ||= result.poor;
            }
            if (poor) {
                weakSamples++;
                goodSamples = 0;
            } else {
                goodSamples++;
                weakSamples = 0;
            }
            if (weakSamples >= 2 || !navigator.onLine || failures >= 2)
                warnConnection(true);
            else if (goodSamples >= 2) warnConnection(false);
        } catch {
        } finally {
            qualityBusy = false;
        }
    }, 3000);
    window.addEventListener("offline", () =>
        warnConnection(
            true,
            "You are offline. Reconnecting when the network returns.",
        ),
    );
    function showReaction(activity) {
        const node = $("<div>", { class: "floating-reaction" })
            .append($("<span>").text(activity.emoji))
            .append($("<small>").text(activity.name));
        $("#reaction-layer").append(node);
        setTimeout(() => node.remove(), 4000);
        $("#reaction-announcement").text(activity.name + " " + activity.emoji);
    }
    const initial = (name) => Array.from(name.trim())[0]?.toUpperCase() || "?";
    const activeVideo = () => screen?.getVideoTracks()[0] || camera;
    function localPreview() {
        const track = activeVideo();
        const stream = new MediaStream(track ? [track] : []);
        $("#preview-video, #local-video").each(function () {
            if (
                this.srcObject?.getVideoTracks()[0]?.id !== track?.id ||
                !this.srcObject
            )
                this.srcObject = stream;
        });
        $(".preview-placeholder").prop("hidden", videoOn);
        $("#local-tile .tile-avatar").prop("hidden", videoOn || sharing);
        $("#local-tile").toggleClass("sharing", sharing);
        $("#preview-mic, #toggle-mic")
            .toggleClass("disabled-state", !audioOn)
            .attr(
                "aria-label",
                audioOn
                    ? Gather.t("Mute microphone")
                    : Gather.t("Turn microphone on"),
            )
            .attr("aria-pressed", String(audioOn));
        $("#toggle-mic").prop("disabled", !!me?.audio_locked);
        $("#muted-by-host").prop("hidden", !me?.audio_locked);
        $("#preview-camera, #toggle-camera")
            .toggleClass("disabled-state", !videoOn)
            .attr(
                "aria-label",
                videoOn
                    ? Gather.t("Turn camera off")
                    : Gather.t("Turn camera on"),
            )
            .attr("aria-pressed", String(videoOn));
        $("#mic-label").text(audioOn ? Gather.t("Mute") : Gather.t("Unmute"));
        $("#camera-label").text(
            videoOn ? Gather.t("Stop video") : Gather.t("Start video"),
        );
        $("#local-muted").prop("hidden", audioOn);
        $("#local-sharing").prop("hidden", !sharing);
        $("#share-screen").attr("aria-pressed", String(sharing));
    }
    async function syncTracks() {
        for (const peer of peers.values()) {
            if (peer.audio) await peer.audio.sender.replaceTrack(microphone);
            if (peer.video) await peer.video.sender.replaceTrack(activeVideo());
        }
        localPreview();
        if (joined && me?.status === "admitted")
            await api("/state", "PATCH", {
                audio: audioOn,
                video: videoOn,
                sharing,
                hand,
            });
    }
    function mediaError(error) {
        if (!window.isSecureContext)
            return Gather.t(
                "Camera and microphone require HTTPS or localhost.",
            );
        if (error.name === "NotAllowedError")
            return Gather.t(
                "Permission was declined. Allow camera or microphone in your browser settings, or join with them off.",
            );
        if (error.name === "NotFoundError")
            return Gather.t(
                "No matching device was found. You can still join with it off.",
            );
        if (error.name === "NotReadableError")
            return Gather.t(
                "This device is busy or unavailable. Check whether another application is using it.",
            );
        return (
            error.message ||
            Gather.t("This media feature is unavailable in your browser.")
        );
    }
    async function toggleDevice(kind, button) {
        $(button).prop("disabled", true);
        try {
            if (!navigator.mediaDevices?.getUserMedia)
                throw new Error(
                    Gather.t(
                        "Camera and microphone require HTTPS or localhost and a supported browser.",
                    ),
                );
            if (kind === "audio") {
                if (me?.audio_locked) {
                    Gather.toast(
                        t(
                            "The host has muted your microphone. Raise your hand to request permission to speak.",
                        ),
                    );
                    return;
                }
                if (!microphone || microphone.readyState === "ended")
                    microphone = (
                        await navigator.mediaDevices.getUserMedia({
                            audio: true,
                        })
                    ).getAudioTracks()[0];
                audioOn = !audioOn;
                microphone.enabled = audioOn;
            } else {
                if (!camera || camera.readyState === "ended")
                    camera = (
                        await navigator.mediaDevices.getUserMedia({
                            video: {
                                width: { ideal: 960 },
                                height: { ideal: 540 },
                            },
                        })
                    ).getVideoTracks()[0];
                videoOn = !videoOn;
                camera.enabled = videoOn;
            }
            await resumeAudio();
            await syncTracks();
        } catch (error) {
            Gather.toast(mediaError(error));
            localPreview();
        } finally {
            $(button).prop("disabled", false);
        }
    }
    $("#preview-mic, #toggle-mic").on("click", function () {
        toggleDevice("audio", this);
    });
    $("#preview-camera, #toggle-camera").on("click", function () {
        toggleDevice("video", this);
    });
    $("#display-name").on("input", function () {
        $("#preview-initial").text(initial(this.value));
    });
    function signal(target, type, payload) {
        return api("/signal", "POST", { target, type, payload });
    }
    function tileFor(id) {
        return document.getElementById("tile-" + id);
    }
    function createTile(member) {
        const tile = $("<article>", {
            class: "video-tile",
            id: "tile-" + member.id,
        });
        tile.append($("<video>", { autoplay: true, playsinline: true }));
        tile.append(
            $("<div>", { class: "tile-avatar" }).append(
                $("<span>").text(initial(member.name)),
            ),
        );
        tile.append($("<div>", { class: "tile-name" }).text(member.name));
        tile.append(
            $("<span>", { class: "peer-status" }).text(Gather.t("Connecting…")),
        );
        tile.append(
            $("<span>", { class: "tile-sharing", hidden: true }).text(
                Gather.t("Presenting"),
            ),
        );
        $("#video-grid").append(tile);
        return tile[0];
    }
    function makePeer(member, initiator = false) {
        if (peers.has(member.id)) return peers.get(member.id);
        const pc = new RTCPeerConnection({ iceServers });
        const peer = {
            pc,
            pending: [],
            stream: new MediaStream(),
            member,
            audio: initiator
                ? pc.addTransceiver(microphone || "audio", {
                      direction: "sendrecv",
                  })
                : null,
            video: initiator
                ? pc.addTransceiver(activeVideo() || "video", {
                      direction: "sendrecv",
                  })
                : null,
        };
        peers.set(member.id, peer);
        const tile = tileFor(member.id) || createTile(member);
        pc.onicecandidate = (event) => {
            if (event.candidate && !stopped)
                signal(member.id, "ice", event.candidate.toJSON()).catch(
                    () => {},
                );
        };
        pc.ontrack = (event) => {
            if (!peer.stream.getTracks().some((t) => t.id === event.track.id))
                peer.stream.addTrack(event.track);
            const video = tile.querySelector("video");
            video.srcObject = peer.stream;
            video
                .play()
                .catch(() =>
                    Gather.toast(
                        Gather.t(
                            "Click a meeting control to allow audio playback.",
                        ),
                    ),
                );
        };
        pc.onconnectionstatechange = () => {
            const status = tile.querySelector(".peer-status");
            status.hidden = pc.connectionState === "connected";
            status.textContent =
                pc.connectionState === "failed"
                    ? Gather.t("Unable to connect · rejoin")
                    : pc.connectionState === "disconnected"
                      ? Gather.t("Reconnecting…")
                      : Gather.t("Connecting…");
            if (pc.connectionState === "failed")
                Gather.toast(
                    Gather.t(
                        "Media connection failed. Rejoin to retry; internet calls may require your own TURN server.",
                    ),
                );
        };
        return peer;
    }
    async function offer(member) {
        const peer = makePeer(member, true);
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        await signal(member.id, "offer", peer.pc.localDescription.toJSON());
    }
    async function consume(event) {
        const member = members.find(
            (p) => p.id === event.sender && p.status === "admitted",
        );
        if (!member) return;
        const peer = makePeer(member);
        const payload = JSON.parse(event.payload);
        if (event.type === "ice") {
            if (peer.pc.remoteDescription)
                await peer.pc.addIceCandidate(payload);
            else peer.pending.push(payload);
        } else {
            if (event.type === "offer" && peer.pc.signalingState !== "stable")
                return;
            if (
                event.type === "answer" &&
                peer.pc.signalingState !== "have-local-offer"
            )
                return;
            await peer.pc.setRemoteDescription(payload);
            if (event.type === "offer") {
                // Reuse the transceivers created by the offer. Pre-creating
                // responder transceivers can leave its sending tracks unpaired.
                peer.audio = peer.pc
                    .getTransceivers()
                    .find((t) => t.receiver.track.kind === "audio");
                peer.video = peer.pc
                    .getTransceivers()
                    .find((t) => t.receiver.track.kind === "video");
                peer.audio.direction = "sendrecv";
                peer.video.direction = "sendrecv";
                await peer.audio.sender.replaceTrack(microphone);
                await peer.video.sender.replaceTrack(activeVideo());
            }
            for (const candidate of peer.pending.splice(0))
                await peer.pc.addIceCandidate(candidate);
            if (event.type === "offer") {
                await peer.pc.setLocalDescription(await peer.pc.createAnswer());
                await signal(
                    member.id,
                    "answer",
                    peer.pc.localDescription.toJSON(),
                );
            }
        }
    }
    function renderPeople(locked, moderated) {
        const list = $("#people-list").empty();
        for (const status of ["admitted", "waiting"]) {
            const group = members.filter((p) => p.status === status);
            if (status === "waiting" && group.length)
                list.append(
                    $("<div>", { class: "waiting-label" }).text(
                        Gather.t("WAITING TO JOIN · ") + group.length,
                    ),
                );
            for (const p of group) {
                const row = $("<div>", { class: "person-row" }).append(
                    $("<span>", { class: "avatar" }).text(initial(p.name)),
                );
                row.append(
                    $("<div>", { class: "person-details" })
                        .append(
                            $("<strong>").text(
                                p.name +
                                    (p.id === me.id ? Gather.t(" (you)") : ""),
                            ),
                        )
                        .append(
                            $("<small>").text(
                                p.is_host
                                    ? Gather.t("Host")
                                    : p.status === "waiting"
                                      ? Gather.t("Waiting for admission")
                                      : p.hand
                                        ? Gather.t("✋ Hand raised")
                                        : p.audio
                                          ? Gather.t("Microphone on")
                                          : Gather.t("Microphone off"),
                            ),
                        ),
                );
                if (me.is_host && !p.is_host && p.id !== me.id) {
                    if (status === "admitted")
                        row.append(
                            $("<button>", {
                                class: "person-action",
                                type: "button",
                                "data-person-control": p.id,
                            })
                                .text(
                                    t(
                                        p.audio_locked
                                            ? "Allow to speak"
                                            : "Mute",
                                    ),
                                )
                                .on("click", () =>
                                    control(
                                        p.audio_locked ? "allow" : "mute",
                                        p.id,
                                    ),
                                ),
                        );
                    if (status === "waiting")
                        row.append(
                            $("<button>", {
                                class: "person-action",
                                type: "button",
                            })
                                .text(Gather.t("Admit"))
                                .on("click", () => control("admit", p.id)),
                        );
                    row.append(
                        $("<button>", {
                            class: "remove-action",
                            type: "button",
                            "aria-label": Gather.t("Remove ") + p.name,
                        })
                            .text(Gather.t("Remove"))
                            .on("click", () => {
                                if (
                                    confirm(
                                        Gather.t("Remove ") +
                                            p.name +
                                            Gather.t(" from this meeting?"),
                                    )
                                )
                                    control("remove", p.id);
                            }),
                    );
                }
                list.append(row);
            }
        }
        $("#host-controls").prop("hidden", !me.is_host);
        $("#allow-all").prop("hidden", !moderated);
        $("#lock-room span").text(
            locked ? Gather.t("Unlock meeting") : Gather.t("Lock meeting"),
        );
        const admitted = members.filter((p) => p.status === "admitted").length;
        $("#participant-count").text(
            admitted +
                (admitted === 1 ? Gather.t(" person") : Gather.t(" people")),
        );
        $("#people-badge").text(members.length);
        $("#alone-hint").prop("hidden", admitted > 1);
        $("#video-grid").toggleClass("single", admitted <= 1);
    }
    function addMessage(message) {
        const node = $("<div>", { class: "chat-message" }).toggleClass(
            "own",
            message.participant_id === me.id,
        );
        node.append(
            $("<div>", { class: "message-meta" })
                .append($("<strong>").text(message.name))
                .append(
                    $("<time>").text(
                        new Date(
                            message.created_at.replace(" ", "T") + "Z",
                        ).toLocaleTimeString(Gather.locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                        }),
                    ),
                ),
        );
        node.append($("<div>", { class: "message-body" }).text(message.body));
        $("#messages").append(node);
        $("#messages")[0].scrollTop = $("#messages")[0].scrollHeight;
        $(".chat-intro").prop("hidden", true);
        if ($("#room-panel").prop("hidden") || $("#chat-panel").prop("hidden"))
            $("#chat-unread").text("•").prop("hidden", false);
        messageCursor = message.id;
    }
    function showCall() {
        $("#waiting, #lobby").prop("hidden", true);
        $("#call, #call-toolbar").prop("hidden", false);
        if (innerWidth <= 800) $("#room-panel").prop("hidden", true);
        if (!startedAt) {
            startedAt = Date.now();
            elapsedTimer = setInterval(() => {
                const seconds = Math.floor((Date.now() - startedAt) / 1000);
                $("#elapsed").text(
                    String(Math.floor(seconds / 60)).padStart(2, "0") +
                        ":" +
                        String(seconds % 60).padStart(2, "0"),
                );
            }, 1000);
        }
        $("#room-status").text(Gather.t("You’re here, together"));
        syncTracks().catch((error) => Gather.toast(Gather.error(error)));
    }
    async function poll() {
        if (stopped || !joined) return;
        let delay = 1200;
        try {
            const data = await api("/poll", "GET", {
                cursor,
                message_cursor: messageCursor,
                activity_cursor: activityCursor,
            });
            failures = 0;
            const wasWaiting = me.status === "waiting";
            const wasAudioLocked = !!me.audio_locked;
            me = data.me;
            if (me.audio_locked) {
                audioOn = false;
                if (microphone) microphone.enabled = false;
            }
            if (!wasAudioLocked && me.audio_locked)
                Gather.toast(
                    t(
                        "The host muted everyone. Raise your hand when you want to speak.",
                    ),
                );
            if (wasAudioLocked && !me.audio_locked)
                Gather.toast(t("You can now unmute your microphone."));
            if (hand && !me.hand) {
                hand = false;
                $("#raise-hand").attr("aria-pressed", "false");
                $("#local-hand").prop("hidden", true);
            }
            localPreview();
            members = data.participants;
            if (me.status === "waiting") {
                $("#room-status").text(Gather.t("Waiting for the host"));
                return;
            }
            if (wasWaiting) showCall();
            $("#room-status").text(
                data.locked
                    ? Gather.t("Meeting locked")
                    : Gather.t("You’re here, together"),
            );
            renderPeople(data.locked, data.moderated);
            const active = members.filter(
                (p) => p.status === "admitted" && p.id !== me.id,
            );
            for (const [id, peer] of peers) {
                if (!active.some((p) => p.id === id)) {
                    peer.pc.close();
                    peers.delete(id);
                    $(tileFor(id)).remove();
                }
            }
            for (const member of active) {
                if (!peers.has(member.id) && me.id < member.id) {
                    try {
                        await offer(member);
                    } catch (error) {
                        console.warn(
                            Gather.t("WebRTC offer failed:"),
                            error.message || Gather.error(error),
                        );
                        peers.get(member.id)?.pc.close();
                        peers.delete(member.id);
                        $(tileFor(member.id)).remove();
                    }
                }
                const tile = tileFor(member.id);
                if (tile) {
                    tile.querySelector("video").muted =
                        !!member.audio_locked || !member.audio;
                    $(tile).toggleClass("sharing", !!member.sharing);
                    $(tile)
                        .find(".tile-avatar")
                        .prop("hidden", !!member.video || !!member.sharing);
                    $(tile)
                        .find(".tile-sharing")
                        .prop("hidden", !member.sharing);
                    $(tile)
                        .find(".tile-name")
                        .text(
                            member.name +
                                (member.hand ? " ✋" : "") +
                                (!member.audio ? Gather.t(" · muted") : ""),
                        );
                }
            }
            for (const event of data.events) {
                try {
                    await consume(event);
                } catch (error) {
                    console.warn(
                        Gather.t("WebRTC negotiation:"),
                        error.message || Gather.t("invalid signal"),
                    );
                }
            }
            cursor = data.cursor;
            for (const message of data.messages) addMessage(message);
            for (const activity of data.activity || []) {
                showReaction(activity);
                activityCursor = activity.id;
            }
        } catch (error) {
            if ([403, 410].includes(error.status)) {
                await exit(Gather.error(error), false);
                return;
            }
            failures++;
            delay = Math.min(10000, 2000 * failures);
            $("#room-status").text(
                Gather.t("Connection interrupted. Retrying…"),
            );
            if (failures === 3)
                Gather.toast(
                    Gather.t(
                        "Server connection interrupted. We’re retrying automatically.",
                    ),
                );
        } finally {
            if (!stopped) pollTimer = setTimeout(poll, delay);
        }
    }
    $("#enter-form").on("submit", async function (event) {
        event.preventDefault();
        if (joined) return;
        $("#join-button").prop("disabled", true);
        $("#lobby-error").prop("hidden", true);
        try {
            if (!window.RTCPeerConnection)
                throw new Error(
                    Gather.t(
                        "Your browser does not support WebRTC. Use a current desktop or mobile browser.",
                    ),
                );
            const data = await api("/enter", "POST", {
                name: $("#display-name").val().trim(),
                audio: audioOn,
                video: videoOn,
            });
            me = data.participant;
            if (me.audio_locked) {
                audioOn = false;
                if (microphone) microphone.enabled = false;
            }
            await resumeAudio();
            iceServers = data.iceServers;
            joined = true;
            $("#local-name").text(me.name);
            $("#local-initial").text(initial(me.name));
            localPreview();
            $("#lobby").prop("hidden", true);
            if (me.status === "waiting") $("#waiting").prop("hidden", false);
            else showCall();
            poll();
        } catch (error) {
            $("#lobby-error")
                .text(
                    error.responseJSON?.message ||
                        error.message ||
                        Gather.t("Unable to join. Try again."),
                )
                .prop("hidden", false);
        } finally {
            $("#join-button").prop("disabled", false);
        }
    });
    async function control(action, target) {
        try {
            await api(
                "/control",
                "POST",
                target ? { action, target } : { action },
            );
            if (action === "end")
                await exit(Gather.t("The meeting has ended."), false);
        } catch (error) {
            Gather.toast(Gather.error(error));
        }
    }
    $("#lock-room").on("click", () => control("lock"));
    $("#mute-all").on("click", () => control("mute_all"));
    $("#allow-all").on("click", () => control("allow_all"));
    $("#reaction-toggle").on("click", function () {
        const open = $("#reaction-picker").prop("hidden");
        $("#reaction-picker").prop("hidden", !open);
        $(this).attr("aria-expanded", String(open));
    });
    $("[data-reaction]").on("click", async function () {
        $("#reaction-picker").prop("hidden", true);
        $("#reaction-toggle").attr("aria-expanded", "false");
        try {
            await api("/reaction", "POST", { emoji: $(this).data("reaction") });
        } catch (error) {
            Gather.toast(Gather.error(error));
        }
    });
    $("#end-room").on("click", () => {
        if (confirm(Gather.t("End this meeting for everyone?"))) control("end");
    });
    $("#chat-form").on("submit", async function (event) {
        event.preventDefault();
        const input = $("#chat-input"),
            body = input.val().trim();
        if (!body) return;
        const button = $(this).find("button");
        button.prop("disabled", true);
        try {
            await api("/chat", "POST", { body });
            input.val("");
        } catch (error) {
            Gather.toast(Gather.error(error));
        } finally {
            button.prop("disabled", false);
        }
    });
    $("#chat-input").on("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!$("#chat-form button").prop("disabled"))
                $("#chat-form").trigger("submit");
        }
    });
    function openPanel(name) {
        $("#room-panel").prop("hidden", false);
        $("#chat-panel").prop("hidden", name !== "chat");
        $("#people-panel").prop("hidden", name !== "people");
        $("[data-panel]")
            .removeClass("active")
            .filter('[data-panel="' + name + '"]')
            .addClass("active");
        if (name === "chat") $("#chat-unread").prop("hidden", true);
    }
    $("[data-panel]").on("click", function () {
        openPanel($(this).data("panel"));
    });
    $("#toggle-chat").on("click", () => openPanel("chat"));
    $("#toggle-people").on("click", () => openPanel("people"));
    $("#close-panel").on("click", () => $("#room-panel").prop("hidden", true));
    $("#copy-code").on("click", () => Gather.copy(location.href));
    $("#layout-toggle").on("click", function () {
        const focused = $("#video-grid")
            .toggleClass("focus-mode")
            .hasClass("focus-mode");
        if (focused) {
            const target =
                $("#video-grid .sharing").first()[0] ||
                $("#video-grid .video-tile:not(.local-tile)").first()[0];
            if (target) $("#video-grid").prepend(target);
        }
        $(this)
            .contents()
            .filter(function () {
                return this.nodeType === 3;
            })
            .remove();
        $(this).append(
            document.createTextNode(
                focused ? Gather.t("Grid view") : Gather.t("Focus view"),
            ),
        );
    });
    $("#raise-hand").on("click", async function () {
        const next = !hand;
        try {
            await api("/state", "PATCH", { hand: next });
            hand = next;
            $(this)
                .attr("aria-pressed", String(hand))
                .attr(
                    "aria-label",
                    hand ? Gather.t("Lower hand") : Gather.t("Raise hand"),
                );
            $("#local-hand").prop("hidden", !hand);
        } catch (error) {
            Gather.toast(Gather.error(error));
        }
    });
    async function stopShare() {
        const old = screen;
        screen = null;
        sharing = false;
        old?.getTracks().forEach((t) => t.stop());
        await syncTracks();
    }
    $("#share-screen").on("click", async function () {
        $(this).prop("disabled", true);
        try {
            if (sharing) await stopShare();
            else {
                if (!navigator.mediaDevices?.getDisplayMedia)
                    throw new Error(
                        Gather.t(
                            "Screen sharing is not available in this browser or context.",
                        ),
                    );
                screen = await navigator.mediaDevices.getDisplayMedia({
                    video: true,
                    audio: false,
                });
                sharing = true;
                screen.getVideoTracks()[0].onended = () => {
                    if (sharing) stopShare().catch(() => {});
                };
                await syncTracks();
            }
        } catch (error) {
            Gather.toast(mediaError(error));
        } finally {
            $(this).prop("disabled", false);
        }
    });
    $("#record-button").on("click", function () {
        if (recordingBusy) return;
        if (recorder?.state === "recording") {
            recorder.stop();
            return;
        }
        document.getElementById("record-dialog").showModal();
    });
    $("#start-recording").on("click", async function () {
        if (recordingBusy || recorder) return;
        recordingBusy = true;
        $(this).prop("disabled", true);
        try {
            if (
                !window.MediaRecorder ||
                !navigator.mediaDevices?.getDisplayMedia
            )
                throw new Error(
                    Gather.t(
                        "Local screen recording is unavailable in this browser.",
                    ),
                );
            recordingMixer = new GatherMedia.Mixer();
            await recordingMixer.resume();
            recordingStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
            });
            recordingMixer.sync(audioInputs());
            const mixedStream = new MediaStream([
                ...recordingStream.getVideoTracks(),
                ...recordingMixer.destination.stream.getAudioTracks(),
            ]);
            const chunks = [];
            const mimeType = [
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm",
            ].find((type) => MediaRecorder.isTypeSupported(type));
            recorder = new MediaRecorder(
                mixedStream,
                mimeType ? { mimeType } : {},
            );
            recorder.ondataavailable = (e) => {
                if (e.data.size) chunks.push(e.data);
            };
            recorder.onstop = () => {
                const mime = recorder.mimeType;
                const blob = new Blob(chunks, { type: mime });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download =
                    "gather-" +
                    cfg.code +
                    "-" +
                    Date.now() +
                    (mime.includes("mp4") ? ".mp4" : ".webm");
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                recordingStream?.getTracks().forEach((t) => t.stop());
                recordingStream = null;
                recordingMixer?.close();
                recordingMixer = null;
                recorder = null;
                $("#record-button").text(Gather.t("Record locally"));
                Gather.toast(
                    Gather.t("Your recording has been saved to your device."),
                );
            };
            recordingStream.getVideoTracks()[0].onended = () => {
                if (recorder?.state === "recording") recorder.stop();
            };
            recorder.start(1000);
            $("#record-button").text(Gather.t("● Stop recording"));
            document.getElementById("record-dialog").close();
        } catch (error) {
            recordingStream?.getTracks().forEach((t) => t.stop());
            recordingMixer?.close();
            recordingMixer = null;
            recorder = null;
            Gather.toast(mediaError(error));
        } finally {
            recordingBusy = false;
            $(this).prop("disabled", false);
        }
    });
    async function exit(
        message = Gather.t("A little closer. A lot more possible."),
        notify = true,
    ) {
        if (stopped) return;
        stopped = true;
        clearTimeout(pollTimer);
        clearInterval(elapsedTimer);
        clearInterval(meterTimer);
        clearInterval(qualityTimer);
        for (const meter of meters.values()) meter.close();
        meters.clear();
        audioContext?.close();
        if (notify && joined) {
            try {
                await api("/leave", "POST", {});
            } catch {}
        }
        if (recorder?.state === "recording") recorder.stop();
        for (const peer of peers.values()) peer.pc.close();
        peers.clear();
        [microphone, camera].forEach((t) => t?.stop());
        screen?.getTracks().forEach((t) => t.stop());
        $("#lobby, #waiting, #call, #call-toolbar").prop("hidden", true);
        $("#exit-screen").prop("hidden", false);
        $("#exit-message").text(message);
        $("#room-status").text(Gather.t("Meeting left"));
    }
    $("#leave-room, #cancel-wait").on("click", () => exit());
    $(document).on("click", () => {
        resumeAudio().catch(() => {});
        $("video").each(function () {
            if (this.srcObject) this.play().catch(() => {});
        });
    });
    window.addEventListener("pagehide", () => {
        if (joined && !stopped) {
            const data = new FormData();
            data.append("_token", $('meta[name="csrf-token"]').attr("content"));
            navigator.sendBeacon(cfg.base + "/leave", data);
        }
    });
    localPreview();
    document.addEventListener("gather:language", () => {
        localPreview();
        $(".local-tile .tile-name small").text(t("(you)"));
        const count = members.filter((p) => p.status === "admitted").length;
        if (count)
            $("#participant-count").text(
                count + t(count === 1 ? " person" : " people"),
            );
        $("#raise-hand").attr(
            "aria-label",
            t(hand ? "Lower hand" : "Raise hand"),
        );
        if (!$("#connection-warning").prop("hidden")) warnConnection(true);
    });
});
