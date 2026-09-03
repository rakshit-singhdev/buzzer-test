const { Worker } = require("worker_threads");
const path = require("path");
const { joinPlayersByCode } = require("./fetch-players.js");
const { joinCode, apiBaseUrl, teamNumber, buzzerAt, playersPerTeam, playerPrefix } = require("./config.js");

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

async function main() {
    if (!joinCode || !Number.isInteger(teamNumber) || teamNumber < 1 || !buzzerAt) {
        throw new Error("Set JOIN_ID, TEAM_NUMBER, and BUZZ_AT (ISO timestamp or epoch milliseconds)");
    }
    const startAt = /^\d+$/.test(buzzerAt) ? Number(buzzerAt) : Date.parse(buzzerAt);
    if (!Number.isFinite(startAt) || startAt <= Date.now()) {
        throw new Error("BUZZ_AT must be a valid future timestamp");
    }
    if (!Number.isInteger(playersPerTeam) || playersPerTeam < 1) {
        throw new Error("PLAYERS_PER_TEAM must be a positive integer");
    }
    const players = await joinPlayersByCode(apiBaseUrl, joinCode, teamNumber, playersPerTeam, playerPrefix);

    console.log(`Starting ${players.length} workers for game "${joinCode}"...\n`);

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
                        `✅ ${msg.playerName} connected | socket=${msg.socketId} | ${msg.connectedTime}`
                    );

                    getRow(msg.playerId)["Player Name"] = msg.playerName;
                    getRow(msg.playerId)["Connected At"] = msg.connectedTime;

                    ready++;

                    if (ready === players.length) {
                        console.log("\nAll workers connected.");

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

                case "assigned":
                    console.log(`Assigned buzzer player: ${msg.playerName}; waiting for target time`);
                    break;

                case "persisted":
                    console.log(`Press stored in DB after latency compensation: ${msg.playerName}`);
                    console.log(`   Stored press time: ${msg.storedTime}`);
                    getRow(msg.playerId)["DB Pressed At"] = msg.storedTime;
                    break;


                case "buzzed":

                    console.log(
                        `⚡ ${msg.playerName}`
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
                        `📩 ${msg.playerName}`
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
                    break;

                case "error":

                    console.error(
                        `❌ ${msg.playerName}`,
                        msg.error
                    );

                    getRow(msg.playerId).Result = "ERROR";
                    getRow(msg.playerId).Message = msg.error;

                    break;


                case "disconnected":

                    console.log(
                        `🔌 ${msg.playerName} disconnected | ${msg.disconnectedTime} | timestamp (ms): ${msg.disconnectedAt}`
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
