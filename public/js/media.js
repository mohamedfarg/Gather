/* Browser-only audio analysis/mixing and connection diagnostics. */
window.GatherMedia = {
    quality(stats, previous = new Map()) {
        let poor = false;
        const current = new Map();
        stats.forEach((report) => {
            if (
                report.type === "candidate-pair" &&
                report.state === "succeeded" &&
                (report.nominated || report.selected)
            ) {
                poor ||= (report.currentRoundTripTime || 0) > 0.6;
            }
            if (report.type === "remote-inbound-rtp") {
                poor ||=
                    (report.roundTripTime || 0) > 0.6 ||
                    (report.fractionLost || 0) > 0.05;
            }
            if (report.type === "inbound-rtp") {
                const received = report.packetsReceived || 0,
                    lost = Math.max(0, report.packetsLost || 0);
                current.set(report.id, { received, lost });
                const old = previous.get(report.id);
                if (old && received >= old.received && lost >= old.lost) {
                    const count = received - old.received + lost - old.lost;
                    poor ||= count > 20 && (lost - old.lost) / count > 0.05;
                }
                poor ||= (report.jitter || 0) > 0.08;
            }
        });
        return { poor, current };
    },
    Meter: class {
        constructor(track, context) {
            this.source = context.createMediaStreamSource(
                new MediaStream([track]),
            );
            this.analyser = context.createAnalyser();
            this.analyser.fftSize = 512;
            this.source.connect(this.analyser);
            this.samples = new Float32Array(512);
        }
        level() {
            this.analyser.getFloatTimeDomainData(this.samples);
            return Math.sqrt(
                this.samples.reduce((sum, n) => sum + n * n, 0) /
                    this.samples.length,
            );
        }
        close() {
            this.source.disconnect();
            this.analyser.disconnect();
        }
    },
    Mixer: class {
        constructor() {
            this.context = new (
                window.AudioContext || window.webkitAudioContext
            )();
            this.destination = this.context.createMediaStreamDestination();
            this.compressor = this.context.createDynamicsCompressor();
            this.compressor.connect(this.destination);
            this.sources = new Map();
        }
        async resume() {
            await this.context.resume();
        }
        sync(inputs) {
            const live = new Set();
            for (const { track, allowed } of inputs) {
                if (!track || track.readyState !== "live") continue;
                live.add(track.id);
                let node = this.sources.get(track.id);
                if (!node) {
                    const source = this.context.createMediaStreamSource(
                        new MediaStream([track]),
                    );
                    const gain = this.context.createGain();
                    source.connect(gain);
                    gain.connect(this.compressor);
                    node = { source, gain };
                    this.sources.set(track.id, node);
                }
                node.gain.gain.setTargetAtTime(
                    allowed ? 1 : 0,
                    this.context.currentTime,
                    0.02,
                );
            }
            for (const [id, node] of this.sources)
                if (!live.has(id)) {
                    node.source.disconnect();
                    node.gain.disconnect();
                    this.sources.delete(id);
                }
        }
        close() {
            for (const node of this.sources.values()) {
                node.source.disconnect();
                node.gain.disconnect();
            }
            this.sources.clear();
            this.destination.stream.getTracks().forEach((t) => t.stop());
            return this.context.close();
        }
    },
};
