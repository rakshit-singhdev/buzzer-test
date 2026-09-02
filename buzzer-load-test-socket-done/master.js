const { Worker } = require("worker_threads");
const path = require("path");
const { fetchPlayersByCode } = require("./fetch-players.js");

const joinCode = "TY3PD2";
const mongoUri ="mongodb+srv://rohityadavdeligence_db_user:rohit123@cluster0.7ljqk7x.mongodb.net/fmly";

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
    const players = await fetchPlayersByCode(mongoUri, joinCode);

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
                        `✅ ${msg.playerId} connected | socket=${msg.socketId} | ${msg.connectedTime}`
                    );

                    getRow(msg.playerId)["Connected At"] = msg.connectedTime;

                    ready++;

                    if (ready === players.length) {
                        console.log("\nAll workers connected.");

                        /*
                         * Everyone receives exactly the same target timestamp.
                         */
                        // const startAt = Date.now() + 5000;
                        const startAt = new Date("2026-09-02T16:10:00+05:30").getTime();

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
