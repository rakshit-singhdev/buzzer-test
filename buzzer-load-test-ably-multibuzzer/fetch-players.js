const os = require("os");
const { MongoClient } = require("mongodb");

/**
 * Local device IP used as part of the generated player name/deviceId,
 * mirroring how a real device would join from its own IP address.
 */
function getLocalDeviceIp() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }

    return "127.0.0.1";
}

async function getSessionByCode(apiBaseUrl, joinCode) {
    const res = await fetch(`${apiBaseUrl}/game-session/${joinCode}/code`);
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(body?.message || `Failed to fetch session "${joinCode}"`);
    }

    return body.data ?? body;
}

async function joinPlayer(apiBaseUrl, joinCode, teamId, name, deviceId) {
    const res = await fetch(`${apiBaseUrl}/game-session/${joinCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, name, deviceId }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(body?.message || `Failed to join player "${name}"`);
    }

    return body.data ?? body;
}

/**
 * `/join` always creates a brand new player, even for a deviceId that
 * already joined - the dedup-by-deviceId lookup only exists on `/rejoin`.
 * Returns the existing player's {session, teamId, playerId}, or null if
 * this deviceId hasn't joined yet (backend responds 404 in that case).
 */
async function rejoinPlayer(apiBaseUrl, joinCode, deviceId) {
    const res = await fetch(`${apiBaseUrl}/game-session/${joinCode}/rejoin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
    });

    if (res.status === 404) {
        return null;
    }

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(body?.message || `Failed to rejoin device "${deviceId}"`);
    }

    return body.data ?? body;
}

/**
 * Joins `playersPerTeam` players onto every team of the game session behind
 * `joinCode`, via the same REST flow a real device uses. Each player is
 * named "<teamName><localDeviceIp><serialNo>" (serial numbers reset per
 * team, starting at 1) and that same string is reused as the deviceId.
 *
 * `/join` (POST :code/join) always creates a brand new player regardless of
 * deviceId - it has no dedup check - so re-running this against an
 * already-joined session would otherwise keep adding players until the team
 * hits `maxPlayersPerTeam` and every join starts failing with "This team is
 * full". To make reruns idempotent, each device first tries `/rejoin`
 * (POST :code/rejoin, matched by deviceId across the whole session) and
 * only falls back to `/join` when that comes back 404 (device genuinely
 * hasn't joined yet).
 *
 * Returns the flat list of {sessionId, role, teamId, playerId, playerName}
 * entries the load test workers expect.
 */
async function joinPlayersByCode(apiBaseUrl, joinCode, playersPerTeam) {
    const session = await getSessionByCode(apiBaseUrl, joinCode);
    const teams = session.teams ?? [];

    if (teams.length === 0) {
        throw new Error(`Game session "${joinCode}" has no teams to join`);
    }

    const deviceIp = getLocalDeviceIp();
    const players = [];

    for (const team of teams) {
        for (let serialNo = 1; serialNo <= playersPerTeam; serialNo++) {
            const name = `Device ${deviceIp} ${team.name} Player${serialNo}`;

            const rejoined = await rejoinPlayer(apiBaseUrl, joinCode, name);

            const result =
                rejoined ??
                (await joinPlayer(apiBaseUrl, joinCode, team._id, name, name));

            players.push({
                sessionId: (result.session?._id ?? session._id).toString(),
                role: "team",
                teamId: (result.teamId ?? team._id).toString(),
                playerId: result.playerId,
                playerName: name,
            });
        }
    }

    return players;
}

/**
 * Looks up an existing game session directly in MongoDB by its join `code`
 * (bypassing the join-team REST flow) and returns the flat list of
 * {sessionId, role, teamId, playerId, gameliveId} entries the load test
 * workers expect, for players that have already joined the session.
 *
 * Sessions store teams/players as embedded subdocuments
 * (`gamesessions.teams[].players[]`), so there's no separate players
 * collection to query. `gameliveId` is the `_id` of the session's single
 * `gamelives` document (one per session, shared by every player in it).
 */
async function fetchPlayersByCode(mongoUri, joinCode) {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        const db = client.db();

        const session = await db.collection("gamesessions").findOne({
            code: joinCode.toUpperCase(),
            isDeleted: { $ne: true },
        });

        if (!session) {
            throw new Error(`Game session with code "${joinCode}" not found`);
        }

        const gameLive = await db.collection("gamelives").findOne({
            sessionId: session._id,
        });

        const players = [];

        for (const team of session.teams ?? []) {
            for (const player of team.players ?? []) {
                players.push({
                    sessionId: session._id.toString(),
                    role: "team",
                    teamId: team._id.toString(),
                    playerId: player._id.toString(),
                    gameliveId: gameLive?._id?.toString() ?? null,
                });
            }
        }

        return players;
    } finally {
        await client.close();
    }
}

module.exports = { joinPlayersByCode, fetchPlayersByCode, getLocalDeviceIp };