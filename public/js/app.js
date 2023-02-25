(function () {

    function selectView(view) {
        $(`div[data-view]`).hide();
        $(`div[data-view="${view}"]`).show();
    }

    /**
     * Obtains parameters from the hash of the URL
     * @return Object
     */
    function getHashParams() {
        var hashParams = {};
        var e, r = /([^&;=]+)=?([^&;]*)/g,
            q = window.location.hash.substring(1);
        while (e = r.exec(q)) {
            hashParams[e[1]] = decodeURIComponent(e[2]);
        }
        return hashParams;
    }

    var userProfileSource = document.getElementById('user-profile-template').innerHTML,
        userProfileTemplate = Handlebars.compile(userProfileSource),
        userProfilePlaceholder = document.getElementById('user-profile');

    var params = getHashParams();

    var access_token = Cookies.get("access_token"),
        refresh_token = Cookies.get("refresh_token"),
        error = params.error ?? null

    if (error) {
        alert(error);
    }

    if (!access_token) {
        // render initial screen
        selectView("login");
        return;
    }

    $.ajax({
        url: 'https://api.spotify.com/v1/me',
        headers: {
            'Authorization': 'Bearer ' + access_token
        },
        success: function (response) {
            
            // Instantiate User Profile Template
            userProfilePlaceholder.innerHTML = userProfileTemplate(response);

            selectView("loggedin");

            $('.btn.generateRandomPlaylist').click(function () {
                let getType = $(this).attr("data-type");
                $.ajax({
                    url: '/refresh_token',
                    data: {
                        'refresh_token': refresh_token
                    },
                }).done(function (data) {
                    access_token = data.access_token;
                    $.ajax({
                        url: '/generateRandomPlaylist',
                        method: 'post',
                        contentType: "application/json; charset=UTF-8",
                        dataType: 'json',
                        data: JSON.stringify({
                            timeRange: $("#spotifyTimeranges").val(),
                            playlistName: $("#spotifyPlaylistName").val(),
                            type: getType
                        })
                    }).done((data) => {
                        alert(data.success ? `Playlist ${data.spotifyPlaylistName} generated` : `Something went wrong when generating your playlist.`);
                    });
                });
            });
        }
    });
})();

