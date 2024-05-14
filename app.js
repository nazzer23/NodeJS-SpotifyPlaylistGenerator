require("dotenv").config();

let express = require('express');
let axios = require('axios');
let cors = require('cors');
let querystring = require('querystring');
let cookieParser = require('cookie-parser');

const app = express();

const {CLIENT_ID, CLIENT_SECRET, CALLBACK_URL, WEB_PORT, GENRE_SONG_CHUNK} = process.env;
let redirectUri = `${CALLBACK_URL}/callback`;

let generateRandomString = function (length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

let stateKey = 'spotify_auth_state';

app.use(express.static(__dirname + '/public'))
    .use(cors())
    .use(cookieParser())
    .use(express.json());

app.get('/login', function (req, res) {

    let state = generateRandomString(16);
    res.cookie(stateKey, state);

    // your application requests authorization
    let permissionScopes = [
        'user-read-private',
        'user-read-email',
        'playlist-read-collaborative',
        'playlist-read-private',
        'playlist-modify-private',
        'playlist-modify-public',
        'user-top-read'
    ];
    let scope = permissionScopes.join(' ');
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: CLIENT_ID,
            scope: scope,
            redirect_uri: redirectUri,
            state: state
        }));
});

app.get('/callback', async (req, res) => {

    // your application requests refresh and access tokens
    // after checking the state parameter

    let code = req.query.code || null;
    let state = req.query.state || null;
    let storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            })
        );
        return;
    }

    res.clearCookie(stateKey);
    let authOptions = {
        method: 'post',
        url: 'https://accounts.spotify.com/api/token',
        params: {
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        },
        headers: {
            'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))
        },
        json: true
    };

    const authorizationResponse = await axios(authOptions);
    if (authorizationResponse.status !== 200) {
        res.clearCookie('access_token');
        res.clearCookie('refresh_token');
        res.clearCookie('clientID');
        res.clearCookie('country');
        res.redirect('/#' +
            querystring.stringify({
                error: 'invalid_token'
            })
        );
        return;
    }

    let body = authorizationResponse.data;

    let access_token = body.access_token,
        refresh_token = body.refresh_token;

    // use the access token to access the Spotify Web API
    const spotifyResponse = await performSpotifyRequest(access_token, 'https://api.spotify.com/v1/me');

    // we can also pass the token to the browser to make requests from there
    res.cookie("clientID", spotifyResponse.data.id);
    res.cookie("country", spotifyResponse.data.country);
    res.cookie("access_token", access_token);
    res.cookie("refresh_token", refresh_token);
    res.redirect("/");
});

app.get('/refresh_token', function (req, res) {

    // requesting access token from refresh token
    let refresh_token = req.cookies ? req.cookies['refresh_token'] : null;
    let authOptions = {
        method: "post",
        url: 'https://accounts.spotify.com/api/token',
        headers: {'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))},
        params: {
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        },
        json: true
    };

    axios(authOptions).then((response) => {
        let body = response.data;
        if (response.status === 200) {
            let access_token = body.access_token;
            res.cookie("access_token", access_token);
            res.json({
                'access_token': access_token
            });
        }
    }).catch((err) => {
        console.log(err)
    });
});

app.post('/generateRandomPlaylist', async (req, res) => await generateRandomPlaylist(req, res));

// User Logout Handler
app.get('/logout', (req, res) => {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.clearCookie('clientID');
    res.clearCookie('country');
    res.redirect('/');
})

console.log(`Listening on ${WEB_PORT} with callback URL ${CALLBACK_URL}`);
app.listen(WEB_PORT);

async function generateRandomPlaylist(req, res) {
    const {clientID, access_token, country} = req.cookies;

    // Allow the ability to specify a playlist name using json payload
    let spotifyPlaylistName = req.body.playlistName;
    if (!spotifyPlaylistName || (spotifyPlaylistName.length <= 0)) {
        spotifyPlaylistName = "Randomly Generated Playlist";
    }

    let acceptableTypes = ["tracks", "genres", "artists"];
    let selectedType = req.body.type;
    if (!acceptableTypes.includes(selectedType)) {
        selectedType = acceptableTypes[0];
    }

    let queryIDs = [];

    // Fetch the current users top artists
    let timeRanges = [
        "short_term",
        "medium_term",
        "long_term"
    ];
    if (req.body.timeRange) {
        if (timeRanges.includes(req.body.timeRange)) {
            timeRanges = [req.body.timeRange];
        }
    }

    // Used to keep a track of which artist ids have already been used.
    let artistsUsed = [];
    let selectedModeType = (selectedType === "tracks") ? 'tracks' : 'artists';
    for await (let timeRange of timeRanges) {
        if (queryIDs.length > 50) {
            continue;
        }

        const totalSongs = selectedModeType === "genres" ? 50 : 10;

        for (let i = 0; i < 20; i++) {

            const seeds = await fetchUsersTopOnMode(access_token, timeRange, totalSongs, selectedModeType, (i * totalSongs));
            if (!seeds) {
                continue;
            }
            if (seeds && seeds.length < 0) {
                continue;
            }

            for (let song of seeds) {
                if (selectedModeType === "tracks") {
                    if (artistsUsed.includes(song['artists'][0]['id'])) {
                        continue;
                    }
                    artistsUsed.push(song['artists'][0]['id']);
                    queryIDs.push(song['id']);
                } else if (selectedType === "genres") {
                    for (let genre of song['genres']) {
                        if (queryIDs.includes(genre)) {
                            continue;
                        }
                        queryIDs.push(genre);
                    }
                } else if (selectedType === "artists") {
                    if (queryIDs.includes(song['id'])) {
                        continue;
                    }
                    queryIDs.push(song['id']);
                }
            }
        }
    }

    // If the user has no tracks, they're probably a new account and as a result, can't be used for recommended
    if (queryIDs.length === 0) {
        res.json({
            "success": false
        })
        return;
    }

    // As the user has a timeframe allocated favourite genres, we can search for a playlist name
    let selectedPlaylistData = await fetchPlaylistDataOnName(spotifyPlaylistName, access_token);
    while (!selectedPlaylistData) {
        // Create a new playlist with that name
        selectedPlaylistData = await createPlaylist(spotifyPlaylistName, clientID, access_token);
    }

    // Assign Spotify Playlist ID if it exists after one attempt
    let spotifyPlaylistID = selectedPlaylistData.id ?? null;
    if (!spotifyPlaylistID) {
        res.json({
            "success": false
        })
        return;
    }

    // Now that we know the playlist exists, we can start to populate it
    const spotifyPlaylistContent = await fetchPlaylistData(access_token, spotifyPlaylistID);
    if (!spotifyPlaylistContent) {
        res.json({
            "success": false
        })
        return;
    }

    // START: Recommendations are used on Top Tracks
    let songRecommendations = [];
    let maxAttemptsToGenre = 0;
    while ((songRecommendations.length < GENRE_SONG_CHUNK) && (maxAttemptsToGenre <= 10)) {
        songRecommendations.concat(await fetchRecommendedSongs(access_token, (country ?? "GB"), `seed_${selectedType}`, queryIDs, spotifyPlaylistContent, songRecommendations));
        maxAttemptsToGenre++;
    }

    // We want to slice the max song chunk size.
    songRecommendations = songRecommendations.slice(0, GENRE_SONG_CHUNK);

    if (songRecommendations && songRecommendations.length > 0) {
        await addSongsToPlaylist(access_token, spotifyPlaylistID, songRecommendations);
    }
    // END: Recommendations are used on Top Tracks

    res.json({
        "success": true,
        spotifyPlaylistID,
        spotifyPlaylistName
    });
}

async function fetchUsersTopOnMode(clientAccessToken, time_range = "short_term", limit = 50, topMode = "artists", offset = 0) {
    const userTopArtistRequest = await performSpotifyRequest(clientAccessToken, `https://api.spotify.com/v1/me/top/${topMode}`, "get", {
        limit,
        time_range,
        offset
    });
    const userTopArtistResponse = userTopArtistRequest.data;
    return userTopArtistResponse['items'] ?? null;
}

async function createPlaylist(playlistName, userID, clientAccessToken) {
    const spotifyPlaylistRequest = await performSpotifyRequest(clientAccessToken, `https://api.spotify.com/v1/users/${userID}/playlists`, "post", {
        "name": playlistName,
        "description": "This playlist was randomly generated.",
        "public": false
    });
    return spotifyPlaylistRequest.data ?? null;
}

async function fetchPlaylistDataOnName(playlistName, clientAccessToken) {
    const spotifyPlaylistRequest = await performSpotifyRequest(clientAccessToken, 'https://api.spotify.com/v1/me/playlists');
    const spotifyPlaylistResponse = spotifyPlaylistRequest.data ?? null;

    // If the playlist is null, the user has no playlists and so we should return null
    if (!spotifyPlaylistResponse) {
        return spotifyPlaylistResponse;
    }

    // Now that we have a collection of the users playlists, we should iterate through and see if a playlist with the name exists.
    let playlistItems = spotifyPlaylistResponse['items'] ?? [];

    // If the items array doesn't exist, we should return null
    if (playlistItems && playlistItems.length === 0) {
        return null;
    }

    let selectedPlaylist = playlistItems.filter(playlist => playlist.name.toLowerCase() === playlistName.toLowerCase());
    if (selectedPlaylist && selectedPlaylist.length === 0) {
        return null;
    }

    return selectedPlaylist[0];
}

async function fetchPlaylistData(userToken, playlistID) {
    let currentPlaylistItems = [];

    let offset = 0;
    let end = false;
    let checkLength = async () => {
        if (end) {
            return;
        }
        const data = await fetchPlaylistDataOffset(userToken, playlistID, offset)
        if (!(data && data["items"] && data["items"]?.length > 0)) {
            end = true;
            return;
        }

        for (let element of data["items"]) {
            let track = element["track"];
            currentPlaylistItems.push(track["uri"]);
        }

        offset = offset + 100;
        await checkLength();
    }
    await checkLength();

    return currentPlaylistItems;
}

async function fetchPlaylistDataOffset(userToken, playlistID, offset = 0) {
    const playlistDataRequest = await performSpotifyRequest(userToken, `https://api.spotify.com/v1/playlists/${playlistID}/tracks?offset=${offset}`);
    return playlistDataRequest.data ?? null;
}

async function fetchRecommendedSongs(userToken, userCountry, typeOfSeeds = "seed_tracks", seeds = [], playlistContent, songRecommendations = []) {
    let songs = songRecommendations ?? [];

    const chunkSize = 5; // Spotify prevents anything greater than this
    for (let i = 0; i < seeds.length; i += chunkSize) {

        let params = {
            [typeOfSeeds]: seeds.slice(i, i + chunkSize).join(","),
            limit: 100,
            market: userCountry
        };

        const spotifyRecommendationRequest = await performSpotifyRequest(
            userToken,
            `https://api.spotify.com/v1/recommendations`,
            "get",
            params
        );

        const spotifyRecommendationResponse = spotifyRecommendationRequest.data ?? null;

        if (!spotifyRecommendationResponse) {
            return [];
        }

        for await (let track of spotifyRecommendationResponse['tracks']) {
            if (playlistContent.includes(track["uri"])) {
                continue;
            }
            if (songRecommendations.includes(track["uri"])) {
                continue;
            }
            if (songs.includes(track["uri"])) {
                continue;
            }
            songs.push(track["uri"]);
        }
    }

    return songs;
}

async function addSongsToPlaylist(userToken, playlistID, songs) {
    const chunkSize = 100; // Spotify prevents anything greater than this
    for (let i = 0; i < songs.length; i += chunkSize) {
        const chunk = songs.slice(i, i + chunkSize);
        await performSpotifyRequest(
            userToken,
            `https://api.spotify.com/v1/playlists/${playlistID}/tracks`,
            "post",
            chunk
        );
    }
}

async function performSpotifyRequest(userToken = null, url, method = "get", params = null) {
    if (!userToken || !url) {
        return null;
    }
    let options = {
        method,
        url,
        json: true,
        headers: {
            Authorization: `Bearer ${userToken}`
        }
    };

    if (params) {
        if (method === "get") {
            options['params'] = params;
        } else {
            options['data'] = JSON.stringify(params);
        }
    }

    return axios(options);
}