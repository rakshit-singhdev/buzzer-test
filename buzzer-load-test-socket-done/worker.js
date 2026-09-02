const { workerData, parentPort } = require("worker_threads");
const { io } = require("socket.io-client");

const {
    sessionId,
    role,
    teamId,
    playerId,
    gameliveId,
} = workerData;

const SERVER_URL = "https://familyfeudbackend.duckdns.org/";

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

const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    autoConnect: true,

    auth: {
        sessionId,
        role,
        teamId: teamId ?? null,
        gameliveId: gameliveId ?? null,
    },
});

socket.on("connect", () => {
    parentPort.postMessage({
        type: "ready",
        playerId,
        socketId: socket.id,
        connectedAt: Date.now(),
        connectedTime: formatTime(Date.now()),
    });
});

socket.on("connect_error", (err) => {
    parentPort.postMessage({
        type: "error",
        playerId,
        error: err.message,
    });
});

socket.on("disconnect", (reason) => {
    parentPort.postMessage({
        type: "disconnected",
        playerId,
        reason,
        disconnectedAt: Date.now(),
        disconnectedTime: formatTime(Date.now()),
    });
});

parentPort.on("message", ({ type, startAt }) => {
    if (type !== "start") return;

    const delay = Math.max(0, startAt - Date.now());

    setTimeout(() => {
        /*
         * This is the timestamp immediately before socket.emit().
         */
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

        socket.emit(
            "buzzer_press",
            {
                playerId,
            },
            (ack) => {
                /*
                 * This is when the ACK reached this worker.
                 */
                const ackReceivedAt = Date.now();

                parentPort.postMessage({
                    type: "ack",

                    playerId,

                    emittedAt,
                    ackReceivedAt,

                    emittedTime: formatTime(emittedAt),
                    ackReceivedTime: formatTime(ackReceivedAt),

                    emitToAckMs: ackReceivedAt - emittedAt,

                    response: ack,
                });

                /*
                 * Disconnect only after the server has responded.
                 */
                socket.disconnect();
            }
        );
    }, delay);
});