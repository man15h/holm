<!-- An example privacy page for a Holm server. It describes what Holm itself
     does. Edit it for your server before turning it on: add what your other
     apps store, your backups, and how people reach you. -->

This dashboard is run by the person who operates this server, on their own hardware.

## What this dashboard stores

- **Who you are, from your sign-in.** Your name, username and groups, as your sign-in provider sends them. They live in a signed cookie that expires after 30 days. The dashboard never sees your sign-in password.
- **Your preferences.** Your layout, bookmarks, theme, wallpaper and weather location, on this server so they follow you between devices.
- **Apps you connect.** If you connect an app to search it from here, the key, token or app password you give is stored on this server, encrypted. For Navidrome, a token derived from your password is stored, not the password. Disconnecting deletes it.

## What leaves this server

- **Weather.** Your browser sends the place you search for, or your coordinates if you use your location, to Open-Meteo, and to OpenStreetMap's Nominatim to name the place.
- **Web search.** A query you send to the fallback search engine goes to that engine.
- **AI answers.** If you connect Claude or OpenAI, a question you choose to ask (Ask, Enter on the Ask pill, or Shift+Enter) and the conversation that follows go from your browser straight to Anthropic or OpenAI, under your own API key and their terms. Your key is saved in that browser only. Neither reaches this server, so the operator sees neither. If the operator set them to run on the server instead, the questions go from this server, which keeps your key encrypted. A self-hosted AI gets them from this server, at the address you entered. The dashboard doesn't keep them; closing the answer forgets it. The key is then only as safe as that browser: an extension, or a bug that lets a script run on the dashboard, could read it. Logging out deletes it from that browser.
- **Pictures.** Wallpapers, icons and posters are fetched by the server from public sources (wsrv.nl and GitLab, jsDelivr and Simple Icons, TMDB), not by your browser. The exception is a logo, font or icon the operator links by URL in the server's configuration: your browser loads that from wherever it's hosted.

## What this dashboard doesn't do

- No analytics, tracking or telemetry
- No advertising, and no selling or sharing of your data

## Questions

Ask the server operator to see or delete what's stored about you.
