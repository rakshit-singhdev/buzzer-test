const { workerData, parentPort } = require("worker_threads");
const { io } = require("socket.io-client");
const { serverUrl: SERVER_URL } = require("./config.js");
const { sessionId, role, teamId, playerId, playerName, playerToken } = workerData;
let targetStartAt = null;
let assigned = false;
let pressScheduled = false;
let persisted = false;

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit",
        second: "2-digit", fractionalSecondDigits: 3,
    });
}

function waitUntil(timestamp, callback) {
    const remaining = timestamp - Date.now();
    if (remaining > 5) {
        setTimeout(() => waitUntil(timestamp, callback), remaining - 2);
    } else if (Date.now() < timestamp) {
        setImmediate(() => waitUntil(timestamp, callback));
    } else {
        callback();
    }
}
const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"], reconnection: true,
    reconnectionAttempts: Infinity, reconnectionDelay: 800, reconnectionDelayMax: 5000,
    timeout: 10000, autoConnect: true,
    auth: { sessionId, role, teamId: teamId ?? null, playerToken },
});

function schedulePress() {
    if (!assigned || targetStartAt == null || pressScheduled) return;
    pressScheduled = true;
    waitUntil(targetStartAt, () => {
        const emittedAt = Date.now();
        const clientTimestamp = performance.now();
        parentPort.postMessage({ type: "buzzed", playerId, playerName, scheduledAt: targetStartAt, emittedAt, clientTimestamp, scheduledTime: formatTime(targetStartAt), emittedTime: formatTime(emittedAt), emitDelayMs: emittedAt - targetStartAt });
        socket.emit("buzzer_press", { playerId, clientTimestamp }, (response) => {
            const ackReceivedAt = Date.now();
            parentPort.postMessage({ type: "ack", playerId, playerName, emittedAt, ackReceivedAt, emittedTime: formatTime(emittedAt), ackReceivedTime: formatTime(ackReceivedAt), emitToAckMs: ackReceivedAt - emittedAt, response });
        });
    });
}
socket.on("connect", () => parentPort.postMessage({ type: "ready", playerId, playerName, socketId: socket.id, connectedAt: Date.now(), connectedTime: formatTime(Date.now()) }));
socket.on("connect_error", (err) => parentPort.postMessage({ type: "error", playerId, playerName, error: err.message }));
socket.on("disconnect", (reason) => parentPort.postMessage({ type: "disconnected", playerId, playerName, reason, disconnectedAt: Date.now(), disconnectedTime: formatTime(Date.now()) }));

socket.on("ping", (payload) => {
    socket.emit("pong", {
        sessionId: payload?.sessionId ?? sessionId,
        serverSentAt: payload?.serverSentAt ?? null,
        clientSentAt: performance.now(),
        playerId,
        teamId: teamId ?? null,
    });
});

socket.on("buzzer_player_set", (payload) => {
    if (String(payload?.teamId) !== String(teamId) || String(payload?.playerId) !== String(playerId)) return;
    assigned = true;
    parentPort.postMessage({ type: "assigned", playerId, playerName });
    schedulePress();
});

function latestRound(rounds) {
    if (!Array.isArray(rounds) || rounds.length === 0) return null;
    return rounds.reduce((latest, round) => {
        if (!latest) return round;
        return (round?.roundNumber ?? -Infinity) >= (latest?.roundNumber ?? -Infinity) ? round : latest;
    }, null);
}

socket.on("buzzer_press", (payload) => {
    // The server includes `pressedBy` for the round the press just resolved in;
    // fall back to the highest-roundNumber round in state.rounds, never the first match,
    // so a stale pressedBy from an earlier round can't be picked up.
    const pressedBy = payload?.pressedBy ?? latestRound(payload?.state?.rounds)?.buzzer?.pressedBy ?? [];
    const press = pressedBy.find((entry) => String(entry.playerId) === String(playerId));
    if (!press || persisted) return;
    persisted = true;
    parentPort.postMessage({ type: "persisted", playerId, playerName, storedTime: formatTime(new Date(press.pressedAt).getTime()) });
    socket.disconnect();
});

parentPort.on("message", ({ type, startAt }) => {
    if (type !== "start") return;
    targetStartAt = startAt;
    schedulePress();
});