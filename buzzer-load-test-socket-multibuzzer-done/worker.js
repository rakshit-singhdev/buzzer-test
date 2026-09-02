const { workerData, parentPort } = require("worker_threads");
const { io } = require("socket.io-client");

const { serverUrl: SERVER_URL } = require("./config.js");

const {
    sessionId,
    role,
    teamId,
    playerId,
    playerName,
    playerToken,
} = workerData;

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
        playerToken,
    },
});

socket.on("connect", () => {
    parentPort.postMessage({
        type: "ready",
        playerId,
        playerName,
        socketId: socket.id,
        connectedAt: Date.now(),
        connectedTime: formatTime(Date.now()),
    });
});

socket.on("connect_error", (err) => {
    parentPort.postMessage({
        type: "error",
        playerId,
        playerName,
        error: err.message,
    });
});

socket.on("disconnect", (reason) => {
    parentPort.postMessage({
        type: "disconnected",
        playerId,
        playerName,
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
            playerName,

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
                    playerName,

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