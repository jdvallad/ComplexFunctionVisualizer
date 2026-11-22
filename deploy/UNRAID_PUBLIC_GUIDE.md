# Unraid & Public Web Deployment Guide

This setup keeps **two completely clean workflows**:

| Workflow | Where it runs | Bind & Security | Command |
| :--- | :--- | :--- | :--- |
| **Personal Terminal** | Your laptop / desktop | `127.0.0.1:1738`, full Live C Compiler enabled | `make web` |
| **Unraid Docker (Public)** | Your Unraid server | `0.0.0.0:1738`, non-root container, Live C Compiler **disabled** (or token-gated) | `docker compose up -d` |

---

## Step 1: Copy Project to Unraid & Build the Image

SSH into your Unraid server (or clone your git repo into `/mnt/user/appdata/complex-visualizer`):

```bash
cd /mnt/user/appdata/complex-visualizer
docker build -t complex-visualizer:latest .
```

The default multi-stage [Dockerfile](../Dockerfile):
- Compiles `visualizer` with `clang -O2` and runs all 45 unit tests during build.
- Copies only the compiled binary and `web/` assets into a tiny Debian runtime image (**no `clang` installed** in the final public image).
- Runs as non-root user `cfv` (UID 1000) with a `/healthz` healthcheck.

---

## Step 2: Run on Unraid (Pick Either Option)

### Option A — Unraid Docker Compose Manager (Recommended)
1. Install the **Docker Compose Manager** plugin from Unraid Community Applications (if not already installed).
2. In `/mnt/user/appdata/complex-visualizer/deploy/`:
   ```bash
   cp .env.example .env
   docker compose up -d --build
   ```
3. Verify locally on your LAN at `http://<UNRAID-IP>:1738`.

### Option B — Unraid Native Docker UI Template
1. Copy `deploy/unraid-template.xml` to your Unraid flash drive:
   ```bash
   cp deploy/unraid-template.xml /boot/config/plugins/dockerMan/templates-user/my-complex-visualizer.xml
   ```
2. In Unraid WebUI: go to **Docker → Add Container → Select Template → `ComplexFunctionVisualizer` → Apply**.

---

## Step 3: Access Safely from School (Public Web)

### Recommended: Cloudflare Tunnel (Zero Open Ports + Free HTTPS + Optional Login Gate!)
School Wi-Fi frequently blocks non-standard ports (like `:1738`), and opening router ports exposes your home IP. **Cloudflare Tunnel** solves both cleanly over standard HTTPS (`443`):

1. Add a domain to a free **Cloudflare** account (or use an existing domain on Cloudflare).
2. Open **Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared).
3. Copy the tunnel token into `deploy/.env` as `CLOUDFLARE_TUNNEL_TOKEN=...`.
4. In the Cloudflare dashboard, add a **Public Hostname**:
   - Subdomain: e.g. `zeta.yourdomain.com`
   - Service Type: `HTTP`
   - URL: `complex-visualizer:1738` (if using the `cloudflared` compose profile below) or `<UNRAID-IP>:1738` (if using Unraid's standalone `cloudflared` app).
5. Start both containers together:
   ```bash
   cd /mnt/user/appdata/complex-visualizer/deploy
   docker compose --profile tunnel up -d
   ```
6. *(Optional Bonus)* In **Cloudflare Zero Trust → Access → Applications**, put a 1-minute **One-Time PIN email gate** in front of `zeta.yourdomain.com` so **only your email** can access it from school!

### Alternative 1: Tailscale (Private Mesh VPN — Zero Public Exposure)
If you only need access from your own laptop/phone at school (not shared school lab computers):
- Install the **Tailscale** plugin on Unraid and the Tailscale app on your laptop.
- Visit `http://<unraid-tailscale-ip>:1738` directly — encrypted end-to-end, nothing exposed to the public internet!

### Alternative 2: Nginx Proxy Manager / SWAG on Unraid
If you already run Nginx Proxy Manager or SWAG on Unraid:
- Create a Proxy Host pointing `zeta.yourdomain.com` → `http://<UNRAID-IP>:1738` with Let's Encrypt SSL enabled.

---

## Step 4 (Optional): Token-Protected Live C Compiler on Unraid

By default, the Docker image disables `/api/compile` (`CFV_ENABLE_COMPILE=0`) so no stranger on the public internet can compile/execute C code on your Unraid server.

If you **do** want to hot-compile C functions from school:
1. Build with `WITH_CLANG=1` so `clang` is included in the runtime container:
   ```bash
   docker build --build-arg WITH_CLANG=1 -t complex-visualizer:latest .
   ```
2. Set a strong secret in `deploy/.env`:
   ```env
   WITH_CLANG=1
   CFV_ENABLE_COMPILE=1
   CFV_COMPILE_TOKEN=use-a-long-random-32-char-secret-here
   ```
3. In `deploy/docker-compose.yml`, change `/tmp:size=32m,noexec` to `/tmp:size=32m` (so `dlopen()` can load compiled `.so` files from `/tmp`).
4. When you open the **`C Editor`** drawer in the browser at school, an **Access Token** password field appears automatically — enter your secret once per session to unlock live `clang` compilation!
