# Put Clan Organizer online

## Do you need this?
**Probably not yet.** To show a friend, open the launcher and press **Share with a friend**. That is free, needs no account and no card.
It works while your computer is on and the launcher window is open.

Permanent hosting means renting a small computer that stays on 24/7, so the app keeps recording wars and history even when your
own PC is off. Everything below is for that. It is optional, and it is the technical part. Do it when you want the app always on.


Hosting it on a small server is the right way to share it: the app needs to run 24/7 to record snapshots and wars,
one server works for any number of clans, and your friend only needs a link.

## 1. Get a server
Any small Linux VPS works (Ubuntu 24.04, 1 GB RAM is plenty, about 4 to 6 USD a month): Hetzner Cloud, DigitalOcean, Vultr, Contabo.
Pick one that accepts your payment card. Free "sleeping" hosts (Render free, Railway trial and similar) are a bad fit because they
stop the background sync and wipe saved history.

## 2. API key
At developer.clashofclans.com create a key and allow the IP **45.79.218.79** (the RoyaleAPI proxy the app uses).
Because of the proxy, your server's own IP does not matter.

## 3. Install
```
scp clan-organizer.zip root@SERVER_IP:/root/
ssh root@SERVER_IP
apt update && apt install -y unzip
curl -fsSL https://get.docker.com | sh
unzip clan-organizer.zip && cd clan-organizer
cp .env.example .env && nano .env        # set COC_API_KEY and ADMIN_PASSWORD
docker compose up -d --build
```
Open `http://SERVER_IP`. Add a clan on the Home page, the first sync starts right away.

## 4. HTTPS and a domain (recommended)
The password travels with every change, so use HTTPS. Point a domain's A record at the server IP, put `DOMAIN=clans.example.com`
in `.env`, then run `docker compose up -d`. Caddy fetches the certificate by itself. Ports 80 and 443 must be open.

## 5. Share it
Send your friend the link and the password. They add their clan, and everyone can browse every clan on the site.
Rosters are saved in each person's own browser. Viewing needs no password, only add clan, remove clan and join dates do.

## Everyday jobs
- Logs: `docker compose logs -f app`
- Update: upload the new zip, unzip over the folder, `docker compose up -d --build` (history in `data/` is kept)
- Backup: copy the `data/` folder
- Limits: 20 clans per site (`MAX_CLANS`), manual Sync now once every 5 minutes per clan (`SYNC_COOLDOWN`)

## Without Docker
```
pip install -r requirements.txt
HOST=0.0.0.0 PORT=5000 COC_API_KEY=... ADMIN_PASSWORD=... python app.py
```
Run it under systemd or tmux so it keeps going, and put any reverse proxy with HTTPS in front.

## Before you make it public
The town hall, league and hero art belongs to Supercell. Supercell's Fan Content Policy allows free fan sites with a
disclaimer (the footer has one) but not selling or monetising them. Read it first. Keep the ClashKing credit in the footer.
