# Summer Game bike route

Astro + Preact + Mapbox: load lawn-code locations, draw an inclusion polygon, then build a **cycling** route through stops in that area (nearest-neighbor order, Mapbox Directions in chunks of up to 25 waypoints). The UI shows **distance in miles**, **time** as minutes or hours+minutes, and **approximate elevation** from Mapbox terrain DEM along the line.

- **GPX export:** After a route is computed, use **Export GPX** to download a `.gpx` file (track + visit-order waypoints) for apps like Komoot, Ride with GPS, or Garmin.
- **AADL branches:** Five [Ann Arbor District Library](https://aadl.org/aboutus/locations) locations are shown as purple dots. You can optionally include one branch as **start**, **roughly halfway**, or **end** of the ride (straight-line ordering for lawn stops, then cycling directions through the full sequence). Branch coordinates are in [`src/data/aadl-libraries.json`](src/data/aadl-libraries.json) (sourced from OpenStreetMap-style lookups; adjust if a building moves).

## Local development

1. Copy environment file and add your Mapbox **public** token:

   ```sh
   cp .env.example .env
   ```

   Set `PUBLIC_MAPBOX_TOKEN` to a token from [Mapbox account](https://account.mapbox.com/) (starts with `pk.`).

2. Install and run:

   ```sh
   npm install
   npm run dev
   ```

   Open [http://localhost:4321](http://localhost:4321).

3. Production build (same as CI):

   ```sh
   npm run build
   npm run preview
   ```

   Static output is written to `dist/`. Before each `npm run build` or `npm run dev`, `prebuild` / `predev` fetches location JSON into `public/data/locations.json` (see [`scripts/copy-data.mjs`](scripts/copy-data.mjs)). The generated file is gitignored; CI uses the same scripts. At runtime the map loads live data from [`public/api/locations.php`](public/api/locations.php) (Apache on the VPS); the baked JSON is a fallback if AADL is unreachable.

## Deploy with GitHub Actions (rsync to VPS)

On every push to `main`, daily at **14:00 UTC**, or when triggered manually, [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs `npm ci`, `npm run build`, then **rsync** `dist/` to your server.

### Triggers

| Trigger | When |
|---------|------|
| Push to `main` | Every code change |
| Schedule | Daily at 14:00 UTC (~10am ET) — refreshes baked fallback data and redeploys |
| Manual | GitHub → Actions → Deploy → **Run workflow** |

To change the daily time, edit the `cron` expression in the workflow (GitHub Actions uses UTC only).

### Repository secrets

| Secret | Description |
|--------|-------------|
| `PUBLIC_MAPBOX_TOKEN` | Mapbox public token (required for the build to embed the key in client JS) |
| `DEPLOY_HOST` | VPS hostname or IP |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_PATH` | Remote directory for site files (e.g. `/var/www/bike-route/` — trailing slash is fine) |
| `SSH_PRIVATE_KEY` | Private key that can SSH as `DEPLOY_USER` (full key including `BEGIN` / `END` lines) |

### Server

- Ensure `DEPLOY_PATH` exists and the SSH user can write there.
- **Apache + PHP:** The site expects Apache to execute `.php` files in the deploy directory. Live location data is served by `api/locations.php` (proxies AADL server-side; falls back to `data/locations.json` if upstream is down). Use **Reload data** on the map to fetch the latest stops without redeploying.
- Configure your web server to serve the deploy directory at the site path (e.g. `/sg-bike-route/`).
- First connection: the workflow uses `ssh-keyscan` so the host key is learned at deploy time. For stricter host verification, add a known-hosts step or pin `SSH_KNOWN_HOSTS` in the workflow.

### Location data

Set `PUBLIC_DATA_URL` in `.env` (or in the workflow `Build` step `env`) to fetch JSON at build time into `public/data/locations.json` (fallback copy). The map loads live data from `api/locations.php` at runtime.

Local dev does not run PHP; Vite proxies `/sg-bike-route/api/locations.php` to AADL (see [`astro.config.mjs`](astro.config.mjs)).
