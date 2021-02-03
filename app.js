require("dotenv").config();

let express = require('express');
let axios = require('axios');
let cors = require('cors');
let querystring = require('querystring');
let cookieParser = require('cookie-parser');

const app = express();

const { CLIENT_ID, CLIENT_SECRET } = process.env;
let redirectUri = "http://localhost:8888/callback";

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
    var scope = 'user-read-private user-read-email playlist-read-collaborative playlist-read-private playlist-modify-private playlist-modify-public user-top-read';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: CLIENT_ID,
            scope: scope,
            redirect_uri: redirectUri,
            state: state
        }));
});

app.get('/callback', function (req, res) {

    // your application requests refresh and access tokens
    // after checking the state parameter

    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            }));
    } else {
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

        axios(authOptions).then((response) => {
            if (response.status === 200) {
                let body = response.data;

                var access_token = body.access_token,
                    refresh_token = body.refresh_token;

                var options = {
                    method: "get",
                    url: 'https://api.spotify.com/v1/me',
                    headers: { 'Authorization': 'Bearer ' + access_token },
                    json: true
                };


                // use the access token to access the Spotify Web API
                axios(options).then((res) => {
                    console.log(`${res.data.display_name} logged in.`);
                });

                // we can also pass the token to the browser to make requests from there
                res.redirect('/#' +
                    querystring.stringify({
                        access_token: access_token,
                        refresh_token: refresh_token
                    }));
            } else {
                res.redirect('/#' +
                    querystring.stringify({
                        error: 'invalid_token'
                    }));
            }
        }).catch((error) => {
            console.log(error)
        });
    }
});

app.get('/refresh_token', function (req, res) {

    // requesting access token from refresh token
    var refresh_token = req.query.refresh_token;
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
            res.send({
                'access_token': access_token
            });
        }
    });
});

app.post('/generate_playlist', (req, res) => {
    let userID = req.body.clientID;
    let clientAccessToken = req.body.access_token;
    let genres = ["metalcore", "punk"]; // TODO
    let playlistName = "Nazzer - NodeJS";

    // Check Playlist Data
    let playlistID = 0;
    new Promise((resolve) => {
        var options = {
            method: "get",
            url: 'https://api.spotify.com/v1/me/playlists',
            headers: { 'Authorization': 'Bearer ' + clientAccessToken },
            json: true
        };
        axios(options).then((response) => {
            let pageData = response.data;
            let found = false;
            pageData["items"].forEach(element => {
                if(element["name"] == playlistName) {
                    resolve(element["id"]);
                    found = true;
                }
            });
            if(!found) {
                createPlaylist(playlistName, userID,clientAccessToken).then((resp) => {
                    resolve(resp);
                });
            }
        }).catch((error) => {
            console.log(error);
        });
    }).then((resolution) => {
        if(resolution == 0) {
            res.send({ sucess: false });
        } else {
            playlistID = resolution;
            console.log(playlistID);

            // Get Playlist Data
            fetchPlaylistData(clientAccessToken, playlistID).then((data) => {
                currentPlaylistItems = data;

                // Now fetch recommended data for the user.
                genres.forEach(element => {
                    console.log(`Fetching songs from ${element}`)
                    fetchRecommendedForGenre(clientAccessToken, element, currentPlaylistItems).then((resp) => {
                        // Lets add those songs to the playlist
                        addSongsToPlaylist(clientAccessToken, playlistID, resp).then((response) => {
                        });
                    });
                });

            });

        }
    });
    //res.send({ sucess: false });
});

console.log('Listening on 8888');
app.listen(8888);

function createPlaylist(playlistName, userID, clientAccessToken) {
    return new Promise((resolve) => {
        let data = JSON.stringify({
            "name": playlistName,
            "description": "This playlist was automatically generated by Nazzer's Spotify Script.",
            "public": false
        });
        let options = {
            method: "post",
            url: `https://api.spotify.com/v1/users/${userID}/playlists`,
            headers: { 'Authorization': 'Bearer ' + clientAccessToken },
            json: true,
            data
        };
        axios(options).then((response) => {
            resolve(response.data.id);
        });
    })
}

function fetchPlaylistData(userToken, playlistID) {
    return new Promise((res) => {
        let currentPlaylistItems = [];

        let offset = 0;
        let end = false;
        let checkLength = () => {
            if(!end) {
                fetchPlaylistDataOffset(userToken, playlistID, offset).then(data => {
                    if(data["items"].length > 0) {
                        data["items"].forEach(element => {
                            let track = element["track"];
                            currentPlaylistItems.push(track["uri"]);
                        });
                        offset = offset + 100;
                        checkLength();
                    } else {
                        end = true;
                        res(currentPlaylistItems);
                    }
                });
            }
        }
        checkLength();
    });
}

function fetchPlaylistDataOffset(userToken, playlistID, offset) {
    return new Promise((res) => {
        var options = {
            method: "get",
            url: `https://api.spotify.com/v1/playlists/${playlistID}/tracks?offset=${offset}`,
            headers: { 'Authorization': 'Bearer ' + userToken },
            json: true
        }
        axios(options).then((response) => {
            let data = response.data;
            res(data);
        }).catch((error) => {
            console.log(error);
        });;       
    })
}

function fetchRecommendedForGenre(userToken, genre, playlistContent) {
    return new Promise((res) => {
        let songs = [];

        data = {
            seed_genres: genre,
            limit:100,
            market:"GB"
        };

        let options = {
            method: "get",
            url: `https://api.spotify.com/v1/recommendations`,
            headers: { 'Authorization': 'Bearer ' + userToken },
            params: data,
            json: true
        }
        axios(options).then((response) => {
            let resData = response.data;
            resData["tracks"].forEach(element => {
                if(!playlistContent.includes(element["uri"])) {
                    songs.push(element["uri"]);
                }
            });
            res(songs);
        }).catch((error) => {
            console.log(error)
        });

    });
}

function addSongsToPlaylist(userToken, playlistID, songs) {
    return new Promise((resolve) => {
        let options = {
            method: "post",
            url: `https://api.spotify.com/v1/playlists/${playlistID}/tracks`,
            headers: { 'Authorization': 'Bearer ' + userToken },
            data: JSON.stringify(songs),
            json: true
        }
        axios(options).then((response) => {
            let resData = response.data;
            resolve(resData);
        }).catch((error) => {
            console.log(error);
        });;
    });
}