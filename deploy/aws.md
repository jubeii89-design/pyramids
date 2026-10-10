# Running Crossword Pyramids on AWS

One small always-on Linux box is the whole architecture. Active rooms are
checkpointed to a local file so a process restart on the same persistent disk
can recover them. The file is not shared state or a backup, so the app must stay
**a single instance** — no autoscaling group, load-balanced pair, or scaling to
2. A second instance will not see rooms created by the first.

For the same reason, skip Lambda + API Gateway WebSockets: it would mean moving
every room and board into DynamoDB. Not worth it for a party game.

## Pick the instance

- **Lightsail Linux instance** — often simplest for a single small service; check
  current plan pricing, included transfer and trial terms in your region.
- **EC2** — flexible and sometimes covered by new-account credits, but bills for
  the instance, disk, addresses and transfer can vary. Set a billing budget and
  verify current pricing before creating resources.

Set a **Budget alert** with a limit you choose before leaving the service running.
Trial credits expire; instances do not stop themselves automatically.

## Set it up

Pick a supported Ubuntu LTS image and install a currently supported Node.js
LTS (the app requires Node 18+). Verify the distribution package version before
using `apt install nodejs`; install Caddy from its maintained repository.

Open ports 80 and 443 in the firewall (Lightsail: Networking → IPv4 Firewall;
EC2: the security group). Port 3000 stays closed — Caddy is the only thing the
internet talks to.

```bash
sudo apt update && sudo apt install -y nodejs npm caddy git
git clone https://github.com/jubeii89-design/pyramids.git
cd pyramids && npm install --omit=dev

sudo cp deploy/pyramids.service /etc/systemd/system/
sudo systemctl enable --now pyramids
curl -s localhost:3000/health          # {"ok":true}
```

If `systemctl status pyramids` is not `active (running)`, `journalctl -u
pyramids -n 50` shows why — almost always a wrong `WorkingDirectory` or `User`
in the unit file if you cloned somewhere other than `/home/ubuntu/pyramids`.

Point a domain (or a free dynamic-DNS name) at the instance's static IP, put
that name in `deploy/Caddyfile`, then:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Put the same address in `deploy/pyramids.service` as `PUBLIC_ORIGIN=https://your-domain`
before you start it. The server refuses to start in production without it, and
browsers connecting from any other origin are rejected (WebSocket close 1008).

Caddy issues the certificate on first request. HTTPS is not optional here: the
host screen builds its QR code from its own origin, and a page served over
HTTPS can only open a `wss://` socket.

The host screen is then at `https://your-domain/host.html`, and that link is
permanent and always awake — no cold start to warm up before players join.

## Updating

```bash
cd ~/pyramids && git pull && npm install --omit=dev
sudo systemctl restart pyramids
```

A process restart recovers active games from `data/rooms.json` on the same disk,
but still avoid deployments mid-session. Keep that directory on persistent,
access-restricted storage; the checkpoint contains credential hashes and private
game state. Back it up encrypted if you need recovery from disk/instance loss.
This single-instance local file is not a substitute for a database, shared
multi-instance storage, or a rehearsed disaster-recovery process.

## Keeping the bill near zero

- One instance, no load balancer. A Lightsail or ALB load balancer costs more
  per month than the server it fronts, and the local checkpoint cannot coordinate
  multiple writers.
- Bundled transfer on the $5 Lightsail plan is far more than this game moves —
  it sends small JSON messages plus one QR PNG per room.
- Stop the instance between game nights if you want to stretch credits; the
  static IP stays attached (on EC2, an unattached Elastic IP is billed).
- `render.yaml` uses a paid single-instance plan and mounted persistent disk for
  the checkpoint; verify current provider plan terms before use. It does not
  provide backup or disaster recovery; see the README for limits.
