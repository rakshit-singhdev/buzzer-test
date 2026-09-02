const { workerData, parentPort } = require("worker_threads");
const Ably = require("ably");
const { serverUrl: SERVER_URL } = require("./config.js");

const {
    sessionId,
    role,
    teamId,
    playerId,
    gameliveId,
} = workerData;

const ABLY_API_KEY = "4A08jg.hhW6UA:jVIeRP8kkRTrAsXtv3SKhA-aG0WWt6UmHo_pzklZ-T8";
const SIGNAL_MESSAGE = "game:signal";
const SIGNAL_ACK_MESSAGE = "game:signal:ack";

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });
}

if (!ABLY_API_KEY) {
    throw new Error("ABLY_API_KEY environment variable is required");
}

const client = new Ably.Realtime({
    key: ABLY_API_KEY,
    clientId: playerId,
    disconnectedRetryTimeout: 2000,
    suspendedRetryTimeout: 5000,
});
const channel = client.channels.get(`game:${sessionId}`);

async function connect() {
    await channel.attach();

    /*
     * The moderator screen's "waiting for players" gate is driven purely by
     * Ably presence (ModeratorSetup.tsx allConnected = every team present in
     * presence.get()), not by the DB roster - joining via REST alone never
     * shows up there.
     */
    await channel.presence.enter({ role: "team", teamId });

    parentPort.postMessage({
        type: "ready",
        playerId,
        clientId: playerId,
        connectedAt: Date.now(),
        connectedTime: formatTime(Date.now()),
    });
}

connect().catch((err) => {
    parentPort.postMessage({
        type: "error",
        playerId,
        error: err.message,
    });
});

parentPort.on("message", async ({ type, startAt }) => {
    if (type !== "start") return;

    const delay = Math.max(0, startAt - Date.now());

    setTimeout(async () => {
        /* This is the timestamp immediately before the Ably publish. */
        const emittedAt = Date.now();

        parentPort.postMessage({
            type: "buzzed",

            playerId,

            scheduledAt: startAt,
            emittedAt,

            scheduledTime: formatTime(startAt),
            emittedTime: formatTime(emittedAt),

            emitDelayMs: emittedAt - startAt,
        });

        const id = crypto.randomUUID();
        const ack = new Promise((resolve) => {
            const listener = (message) => {
                if (message.data?.id !== id) return;
                channel.unsubscribe(SIGNAL_ACK_MESSAGE, listener);
                resolve(message.data.ack ?? { ok: true });
            };
            channel.subscribe(SIGNAL_ACK_MESSAGE, listener).catch((err) => {
                channel.unsubscribe(SIGNAL_ACK_MESSAGE, listener);
                resolve({ ok: false, code: "PUBLISH_ERROR", message: err.message, statusCode: 500 });
            });
        });

        try {
            await channel.publish(SIGNAL_MESSAGE, {
                id,
                action: "buzz",
                teamId,
                playerId,
            });
            const response = await ack;
            const ackReceivedAt = Date.now();

            parentPort.postMessage({
                type: "ack",
                playerId,
                emittedAt,
                ackReceivedAt,
                emittedTime: formatTime(emittedAt),
                ackReceivedTime: formatTime(ackReceivedAt),
                emitToAckMs: ackReceivedAt - emittedAt,
                response,
            });
        } catch (err) {
            parentPort.postMessage({
                type: "error",
                playerId,
                error: err.message,
            });
        } finally {
            /*
             * Leave presence explicitly before closing - otherwise the
             * implicit presence-leave message closing triggers can still be
             * in flight and gets force-failed, logging a harmless but noisy
             * "failing N queued messages" warning from Ably.
             */
            try {
                await channel.presence.leave();
            } catch (err) {
                // Already disconnected or never entered - nothing to clean up.
            }

            client.close();
            const disconnectedAt = Date.now();
            parentPort.postMessage({
                type: "disconnected",
                playerId,
                reason: "completed",
                disconnectedAt,
                disconnectedTime: formatTime(disconnectedAt),
            });
        }
    }, delay);
});