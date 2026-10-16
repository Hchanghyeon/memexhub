# Music

memexhub reads what you listened to (read-only) for the journal: `music_day` lists a day's tracks, and `day_summary` adds one line ("23 tracks · most played: …").

| Service | Setup | History |
|---|---|---|
| **Last.fm** | your user name and an API key from last.fm/api/account/create | everything Last.fm has |
| **Spotify** | create an app at developer.spotify.com, add the redirect URI shown in the form, save the client ID and secret, then **Sign in with Spotify** | Spotify only shows the last 50 plays, so memexhub collects them every 30 minutes from the moment you connect |

Only the read scope `user-read-recently-played` is asked from Spotify. Nothing is ever played, saved or posted.
