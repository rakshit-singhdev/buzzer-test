const { MongoClient } = require("mongodb");

async function fetchPlayersByCode(mongoUri, joinCode) {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();

        const db = client.db();

        const session = await db
            .collection("gamesessions")
            .findOne({ code: joinCode.toUpperCase() });

        if (!session) {
            throw new Error(`No game session found for join code "${joinCode}"`);
        }

        const gameLive = await db
            .collection("gamelives")
            .findOne({ sessionId: session._id });

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

        if (players.length === 0) {
            throw new Error(`Game session "${joinCode}" has no players to load test`);
        }

        return players;
    } finally {
        await client.close();
    }
}

module.exports = { fetchPlayersByCode };
