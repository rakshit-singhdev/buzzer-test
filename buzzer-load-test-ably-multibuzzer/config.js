module.exports = {
    // Game session code used by the load test.
    joinCode: "R3NSHL",

    // REST API base URL, without a trailing slash.
    apiBaseUrl: "http://localhost:4000/api",

    // Socket.IO server URL.
    serverUrl: "http://localhost:4000",

    // Number of test players to create per team.
    playersPerTeam: 5,
};