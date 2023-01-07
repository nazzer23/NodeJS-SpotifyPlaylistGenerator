require("dotenv").config();

let express = require('express');
let axios = require('axios');
let cors = require('cors');
let querystring = require('querystring');
let cookieParser = require('cookie-parser');

const app = express();

const { CLIENT_ID, CLIENT_SECRET, CALLBACK_URL, WEB_PORT } = process.env;
let redirectUri = `${CALLBACK_URL}/callback`;

let generateRandomString = function (length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

var stateKey = 'spotify_auth_state';

app.use(express.static(__dirname + '/public'))
    .use(cors())
    .use(cookieParser())
    .use(express.json());

app.get('/login', function (req, res) {

    var state = generateRandomString(16);
    res.cookie(stateKey, state);

    // your application requests authorization
    var permissionScopes = [
        'user-read-private',
        'user-read-email',
        'playlist-read-collaborative',
        'playlist-read-private',
        'playlist-modify-private',
        'playlist-modify-public',
        'user-top-read'
    ];
    var scope = permissionScopes.join(' ');
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

    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            })
        );
        return;
    }

    res.clearCookie(stateKey);
    var authOptions = {
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

    var access_token = body.access_token,
        refresh_token = body.refresh_token;

    var options = {
        method: "get",
        url: 'https://api.spotify.com/v1/me',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
    };

    // use the access token to access the Spotify Web API
    const spotifyResponse = await axios(options);
    console.log(`${spotifyResponse.data.display_name} logged in.`);
    console.log(spotifyResponse.data)

    // we can also pass the token to the browser to make requests from there

    res.cookie("clientID", spotifyResponse.data.id);
    res.cookie("country", spotifyResponse.data.country);
    res.cookie("access_token", access_token);
    res.cookie("refresh_token", refresh_token);
    res.redirect("/");
    return;
    // res.redirect('/#' +
    //     querystring.stringify({
    //         access_token: access_token,
    //         refresh_token: refresh_token
    //     }));
});

app.get('/refresh_token', function (req, res) {

    // requesting access token from refresh token
    var refresh_token = req.cookies ? req.cookies['refresh_token'] : null;
    var authOptions = {
        method: "post",
        url: 'https://accounts.spotify.com/api/token',
        headers: { 'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')) },
        params: {
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        },
        json: true
    };

    axios(authOptions).then((response) => {
        let body = response.data;
        if (response.status === 200) {
            var access_token = body.access_token;
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

console.log(`Listening on ${WEB_PORT}`);
app.listen(WEB_PORT);

async function generateRandomPlaylist(req, res) {
    const { clientID, access_token, country } = req.cookies;

    // Allow the ability to specify a playlist name using json payload
    let spotifyPlaylistName = req.body.playlistName ?? "Node Generated";

    let spotifyGenreSeeds = [];
    let userGenres = [];

    const genreSeedRequest = await axios({
        method: "get",
        url: 'https://api.spotify.com/v1/recommendations/available-genre-seeds',
        headers: { 'Authorization': 'Bearer ' + access_token },
        json: true
    });

    const genreSeedResponse = genreSeedRequest.data;
    if (!genreSeedResponse) {
        res.json({
            "success": false
        });
        return;
    }

    spotifyGenreSeeds = genreSeedResponse.genres;

    // Fetch the current users top artists
    let timeRanges = [
        "short_term",
        "medium_term",
        "long_term"
    ];

    // Iterate through the time ranges that are accepted by spotify
    for await (let timeRange of timeRanges) {
        if (userGenres.length > 0) {
            continue;
        }

        const userTopArtists = await fetchUsersTopArtists(access_token, timeRange);
        if (!userTopArtists) {
            continue;
        }

        userTopArtists.forEach(artist => {
            let artistGenres = artist['genres'] ?? [];
            artistGenres.forEach(artistGenre => {
                if (spotifyGenreSeeds.includes(artistGenre)) {
                    if (!userGenres.includes(artistGenre)) {
                        userGenres.push(artistGenre);
                    }
                }
            });
        });
    }

    // If the user has no top genres, they're probably a new account and as a result, can't be used for recommended
    if (userGenres.length == 0) {
        res.json({
            "success": false
        })
        return;
    }

    // As the user has a timeframe allocated favourite genres, we can search for a playlist name
    let spotifyPlaylistID = null;
    let selectedPlaylistData = await fetchPlaylistDataOnName(spotifyPlaylistName, access_token);
    if (!selectedPlaylistData) {
        // Create a new playlist with that name
        selectedPlaylistData = await createPlaylist(spotifyPlaylistName, clientID, access_token);
    }
    
    // Assign Spotify Playlist ID if it exists after one attempt
    spotifyPlaylistID = selectedPlaylistData.id ?? null;
    if (!spotifyPlaylistID) {
        res.json({
            "success": false
        })
        return;
    }

    // Now that we know the playlist exists, we can start to populate it
    const spotifyPlaylistContent = await fetchPlaylistData(access_token, spotifyPlaylistID);
    if(!spotifyPlaylistContent) {
        res.json({
            "success": false
        })
        return;
    }

    for await (let genre of userGenres) {
        const songRecommendations = await fetchRecommendedSongsForGenre(access_token, (country ?? "GB"), genre, spotifyPlaylistContent);
        if(songRecommendations.length > 0) {
            await addSongsToPlaylist(access_token, spotifyPlaylistID, songRecommendations);
        }
    }

    res.json({
        "success": true,
        userGenres,
        spotifyPlaylistID
    });

}

async function fetchUsersTopArtists(clientAccessToken, timeRange = "short_term", limit = 50) {
    var options = {
        method: "get",
        url: 'https://api.spotify.com/v1/me/top/artists',
        headers: { 'Authorization': 'Bearer ' + clientAccessToken },
        json: true,
        params: {
            limit,
            "time_range": timeRange
        }
    }

    const userTopArtistRequest = await axios(options);
    const userTopArtistResponse = userTopArtistRequest.data;
    return userTopArtistResponse['items'] ?? null;
}

async function createPlaylist(playlistName, userID, clientAccessToken) {

    let options = {
        method: "post",
        url: `https://api.spotify.com/v1/users/${userID}/playlists`,
        headers: { 'Authorization': 'Bearer ' + clientAccessToken },
        json: true,
        data: JSON.stringify({
            "name": playlistName,
            "description": "This playlist was automatically generated by Nazzer's Spotify Script.",
            "public": false
        })
    };
    
    const spotifyPlaylistRequest = await axios(options);
    const spotifyPlaylistResponse = spotifyPlaylistRequest.data ?? null;
    return spotifyPlaylistResponse;
}

async function fetchPlaylistDataOnName(playlistName, clientAccessToken) {
    var options = {
        method: "get",
        url: 'https://api.spotify.com/v1/me/playlists',
        headers: { 'Authorization': 'Bearer ' + clientAccessToken },
        json: true
    };

    const spotifyPlaylistRequest = await axios(options);
    const spotifyPlaylistResponse = spotifyPlaylistRequest.data ?? null;

    // If the playlist is null, the user has no playlists and so we should return null
    if (!spotifyPlaylistResponse) {
        return spotifyPlaylistResponse;
    }

    // Now that we have a collection of the users playlists, we should iterate through and see if a playlist with the name exists.
    let playlistItems = spotifyPlaylistResponse['items'] ?? [];

    // If the items array doesn't exist, we should return null
    if (playlistItems && playlistItems.length == 0) {
        return null;
    }

    let selectedPlaylist = playlistItems.filter(playlist => playlist.name.toLowerCase() == playlistName.toLowerCase());
    if (selectedPlaylist && selectedPlaylist.length == 0) {
        return null;
    }

    return selectedPlaylist[0];
}

async function fetchPlaylistData(userToken, playlistID) {
    let currentPlaylistItems = [];

    let offset = 0;
    let end = false;
    let checkLength = async () => {
        if (!end) {
            const data = await fetchPlaylistDataOffset(userToken, playlistID, offset)
            if (data["items"].length > 0) {
                data["items"].forEach(element => {
                    let track = element["track"];
                    currentPlaylistItems.push(track["uri"]);
                });
                offset = offset + 100;
                await checkLength();
            } else {
                end = true;
            }
        }
    }
    await checkLength();

    return currentPlaylistItems;
}

async function fetchPlaylistDataOffset(userToken, playlistID, offset = 0) {
    var options = {
        method: "get",
        url: `https://api.spotify.com/v1/playlists/${playlistID}/tracks?offset=${offset}`,
        headers: { 'Authorization': 'Bearer ' + userToken },
        json: true
    }

    const playlistDataRequest = await axios(options);
    const playlistDataResponse = playlistDataRequest.data ?? null;

    return playlistDataResponse;
}

async function fetchRecommendedSongsForGenre(userToken, userCountry, genre, playlistContent) {
    let songs = [];

    data = {
        seed_genres: genre,
        limit: 100,
        market: "GB"
    };

    let options = {
        method: "get",
        url: `https://api.spotify.com/v1/recommendations`,
        headers: { 'Authorization': 'Bearer ' + userToken },
        params: data,
        json: true
    }

    const spotifyRecommendationRequest = await axios(options);
    const spotifyRecommendationResponse = spotifyRecommendationRequest.data ?? null;

    if(!spotifyRecommendationResponse) {
        return [];
    }

    for await(let track of spotifyRecommendationResponse['tracks']) {
        if (!playlistContent.includes(track["uri"])) {
            songs.push(track["uri"]);
        }
    }

    return songs;
}

async function addSongsToPlaylist(userToken, playlistID, songs) {
    let options = {
        method: "post",
        url: `https://api.spotify.com/v1/playlists/${playlistID}/tracks`,
        headers: { 'Authorization': 'Bearer ' + userToken },
        data: JSON.stringify(songs),
        json: true
    }
    await axios(options);
    
}