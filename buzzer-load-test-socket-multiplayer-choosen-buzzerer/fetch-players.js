const os = require("os");

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
 * Joins `playersPerTeam` new players onto the selected team of the game session
 * behind `joinCode`, via the same REST join flow a real device uses
 * (POST /game-session/:code/join). Each player is named
 * "<teamName><localDeviceIp><serialNo>" (serial numbers reset per team,
 * starting at 1), and that same string is reused as the deviceId so
 * re-running the load test against an already-joined session reuses the
 * same player instead of erroring on a full team.
 *
 * Returns the flat list of {sessionId, role, teamId, playerId, playerName}
 * entries the load test workers expect.
 */
async function joinPlayersByCode(apiBaseUrl, joinCode, teamNumber, playersPerTeam, playerPrefix) {
    const session = await getSessionByCode(apiBaseUrl, joinCode);
    const teams = session.teams ?? [];

    if (teams.length === 0 || !teams[teamNumber - 1]) {
        throw new Error(`Team number ${teamNumber} does not exist in game "${joinCode}"`);
    }

    const players = [];

    const team = teams[teamNumber - 1];
    const maxPlayers = session.maxPlayersPerTeam ?? session.rule?.maxPlayersPerTeam;
    const existingLoadTestPlayers = new Set(
        (team.players ?? [])
            .map((player) => player.deviceId)
            .filter((deviceId) => typeof deviceId === "string" && deviceId.startsWith(`${playerPrefix}-`))
    );
    if (Number.isFinite(maxPlayers) && team.players.length - existingLoadTestPlayers.size + playersPerTeam > maxPlayers) {
        throw new Error(
            `Team "${team.name}" has ${team.players.length}/${maxPlayers} players. ` +
            `Set PLAYERS_PER_TEAM to an available seat count or remove old players from the lobby.`
        );
    }

    for (let serialNo = 1; serialNo <= playersPerTeam; serialNo++) {
        const deviceId = `${playerPrefix}-${joinCode}-team${teamNumber}-player${serialNo}`;
        const name = `Load test ${team.name} Player${serialNo}`;

        const joined = await joinPlayer(
                apiBaseUrl,
                joinCode,
                team._id,
                name,
                deviceId
        );

        players.push({
                sessionId: (joined.session?._id ?? session._id).toString(),
                role: "team",
                teamId: (joined.teamId ?? team._id).toString(),
                playerId: joined.playerId,
                playerName: joined.playerName ?? name,
                playerToken: joined.token,
        });
    }

    return players;
}

module.exports = { joinPlayersByCode, getLocalDeviceIp };
