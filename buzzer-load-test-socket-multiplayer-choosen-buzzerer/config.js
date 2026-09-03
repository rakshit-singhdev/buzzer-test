require("dotenv").config();

module.exports = {
    // Required: game join code and 1-based team number.
    joinCode: process.env.JOIN_ID ?? process.env.JOIN_CODE,
    teamNumber: Number(process.env.TEAM_NUMBER),

    // Required: ISO timestamp or Unix epoch milliseconds.
    buzzerAt: process.env.BUZZ_AT ?? process.env.BUZZER_TIME,

    // REST API base URL, without a trailing slash.
    apiBaseUrl: "https://familyfeudbackend.duckdns.org/api",

    // Socket.IO server URL.
    serverUrl: "https://familyfeudbackend.duckdns.org",

    // Ten test players are created on the selected team.
    playersPerTeam: 10,
};
