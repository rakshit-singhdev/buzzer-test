const { Worker } = require("worker_threads");
const path = require("path");
const Ably = require("ably");
const { joinCode, apiBaseUrl, playersPerTeam } = require("./config.js");
const { joinPlayersByCode } = require("./fetch-players.js");

const ABLY_API_KEY = "4A08jg.hhW6UA:jVIeRP8kkRTrAsXtv3SKhA-aG0WWt6UmHo_pzklZ-T8";
const SIGNAL_MESSAGE = "game:signal";
const SIGNAL_ACK_MESSAGE = "game:signal:ack";

const workers = [];
let ready = 0;
let completed = 0;
const results = new Map();

function getRow(playerId) {
    if (!results.has(playerId)) {
        results.set(playerId, { "Player ID": playerId });
    }
    return results.get(playerId);
}

/*
 * In production, buzzes are resolved by the moderator's browser tab
 * (gameEngine.ts pressBuzzer), not by the backend - it's a pure client-to-client
 * Ably relay. Without something acking "game:signal", every buzz here would just
 * time out after 8s. This simulates that moderator resolution so the load test
 * can measure real ack latency and report who actually won the buzzer:
 * first press wins, and locking is per-player (not per-team) - a player can only
 * buzz once, but their teammates can still buzz in independently.
 */
function startModeratorSimulator(sessionId) {
    const moderatorClient = new Ably.Realtime({
        key: ABLY_API_KEY,
        clientId: "load-test-moderator",
    });
    const channel = moderatorClient.channels.get(`game:${sessionId}`);
    const pressedBy = [];

    channel.subscribe(SIGNAL_MESSAGE, async (message) => {
        const { id, action, teamId, playerId } = message.data ?? {};
        if (action !== "buzz") return;

        const alreadyBuzzed = pressedBy.some((b) => b.playerId === playerId);

        const ack = alreadyBuzzed
            ? {
                ok: false,
                code: "GAME_ERROR",
                message: "You've already buzzed",
                statusCode: 400,
            }
            : { ok: true };

        if (!alreadyBuzzed) {
            pressedBy.push({ teamId, playerId, pressedAt: Date.now() });
        }

        try {
            await channel.publish(SIGNAL_ACK_MESSAGE, { id, ack });
        } catch (err) {
            // Can be rejected if the moderator connection closes while this
            // publish is still in flight - the load test is wrapping up by
            // then anyway, so there's nothing useful to do but avoid crashing.
        }
    });

    return {
        attach: () => channel.attach(),
        close: () => {
            try {
                moderatorClient.close();
            } catch (err) {
                // Ably can throw when closing a connection with in-flight
                // messages (e.g. the ack it just published) - the ack has
                // already been sent by this point, so it's safe to ignore.
            }
        },
        getWinner: () => pressedBy[0] ?? null,
        getPressOrder: () => pressedBy,
    };
}

async function main() {
    const players = await joinPlayersByCode(apiBaseUrl, joinCode, playersPerTeam);

    console.log(`Starting ${players.length} workers for game "${joinCode}"...\n`);

    const moderator = startModeratorSimulator(players[0].sessionId);
    await moderator.attach();

    for (const player of players) {
        const worker = new Worker(
            path.join(__dirname, "worker.js"),
            {
                workerData: player,
            }
        );

        workers.push(worker);

        worker.on("message", (msg) => {
            switch (msg.type) {

                case "ready":
                    console.log(
                        `✅ ${msg.playerId} connected | client=${msg.clientId} | ${msg.connectedTime}`
                    );

                    getRow(msg.playerId)["Connected At"] = msg.connectedTime;

                    ready++;

                    if (ready === players.length) {
                        console.log("\nAll workers connected.");

                        /*
                         * Everyone receives exactly the same target timestamp.
                         */
                        // const startAt = Date.now() + 5000;
                        const startAt = new Date("2026-08-24T17:17:00+05:30").getTime();

                        console.log(
                            `Buzz scheduled at ${new Date(startAt).toLocaleString(
                                "en-IN",
                                {
                                    timeZone: "Asia/Kolkata",
                                    hour12: false,
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                    fractionalSecondDigits: 3,
                                }
                            )}`
                        );

                        console.log(
                            `Scheduled timestamp: ${startAt}`
                        );

                        workers.forEach((w) => {
                            w.postMessage({
                                type: "start",
                                startAt,
                            });
                        });
                    }

                    break;


                case "buzzed":

                    console.log(
                        `⚡ ${msg.playerId}`
                    );

                    console.log(
                        `   Scheduled : ${msg.scheduledTime}`
                    );

                    console.log(
                        `   Emitted at  : ${msg.emittedTime}`
                    );

                    console.log(
                        `   Emitted timestamp (ms): ${msg.emittedAt}`
                    );

                    console.log(
                        `   Timer diff: ${msg.emitDelayMs} ms`
                    );

                    Object.assign(getRow(msg.playerId), {
                        Scheduled: msg.scheduledTime,
                        "Emitted At": msg.emittedTime,
                        "Emit Delay (ms)": msg.emitDelayMs,
                    });

                    break;


                case "ack":

                    console.log(
                        `📩 ${msg.playerId}`
                    );

                    console.log(
                        `   Emitted at : ${msg.emittedTime}`
                    );

                    console.log(
                        `   ACK received at : ${msg.ackReceivedTime}`
                    );

                    console.log(
                        `   Emitted timestamp (ms): ${msg.emittedAt}`
                    );

                    console.log(
                        `   ACK received timestamp (ms): ${msg.ackReceivedAt}`
                    );

                    console.log(
                        `   Emit to ACK received: ${msg.emitToAckMs} ms`
                    );

                    console.log(
                        `   Response:`,
                        msg.response
                    );

                    Object.assign(getRow(msg.playerId), {
                        "ACK Received At": msg.ackReceivedTime,
                        "Emit→ACK (ms)": msg.emitToAckMs,
                        Result: msg.response?.ok ? "OK" : "FAILED",
                        Message: msg.response?.message ?? "",
                    });

                    completed++;

                    if (completed === players.length) {
                        const winner = moderator.getWinner();

                        console.log("\n=== Multibuzzer result ===");
                        if (winner) {
                            console.log(
                                `🏆 Winner: ${winner.playerId} (team ${winner.teamId}) at ${winner.pressedAt}`
                            );
                        } else {
                            console.log("No player successfully buzzed in.");
                        }

                        console.log("\nPress order:");
                        moderator.getPressOrder().forEach((b, i) => {
                            console.log(
                                `  ${i + 1}. ${b.playerId} (team ${b.teamId}) @ ${b.pressedAt}`
                            );
                        });

                        moderator.close();
                        process.exit(0);
                    }

                    break;

                case "error":

                    console.error(
                        `❌ ${msg.playerId}`,
                        msg.error
                    );

                    getRow(msg.playerId).Result = "ERROR";
                    getRow(msg.playerId).Message = msg.error;

                    break;


                case "disconnected":

                    console.log(
                        `🔌 ${msg.playerId} disconnected | ${msg.disconnectedTime} | timestamp (ms): ${msg.disconnectedAt}`
                    );

                    break;
            }
        });

        worker.on("error", (err) => {
            console.error(
                `Worker error:`,
                err
            );
        });

        worker.on("exit", (code) => {
            if (code !== 0) {
                console.log(
                    `Worker exited with ${code}`
                );
            }
        });
    }
}

main().catch((err) => {
    console.error("Failed to start load test:", err.message);
    process.exit(1);
});
