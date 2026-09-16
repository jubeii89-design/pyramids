# Running Crossword Pyramids on AWS

One small always-on Linux box is the whole architecture. The game server holds
rooms in memory, so it must be **a single instance** — no autoscaling group, no
load-balanced pair, no App Runner scaling to 2. A second instance means two
players scanning the same QR code land on different servers and the room isn't
there.

For the same reason, skip Lambda + API Gateway WebSockets: it would mean moving
every room and board into DynamoDB. Not worth it for a party game.

## Pick the instance

- **Lightsail, $5/month Linux plan** — the recommended option. Fixed price, no
  metered surprises, static IP and bundled transfer included, and new accounts
  get 3 months free on that plan.
- **EC2 `t4g.small` (Arm)** — fine too, and it draws on the $200 of signup
  credits, but the bill is metered (instance + EBS + data transfer) and becomes
  pay-as-you-go once the credits or the 6-month plan run out.

Either way set a **Budget alert** (Billing → Budgets, e.g. $5/month) before you
walk away. The credits expire; the instance does not stop itself.

## Set it up

Pick the **Ubuntu 24.04 LTS** image. It carries Node 18 and Caddy 2.6 in its
own archive, so the install is three `apt` packages and nothing else. (On
22.04, `apt install nodejs` gives you Node 12, which is too old for this app —
you would have to add the NodeSource repo. Save yourself the detour.)

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

A restart drops any game in progress, so don't deploy mid-session.

## Keeping the bill near zero

- One instance, no load balancer. A Lightsail or ALB load balancer costs more
  per month than the server it fronts, and this app cannot use a second node.
- Bundled transfer on the $5 Lightsail plan is far more than this game moves —
  it sends small JSON messages plus one QR PNG per room.
- Stop the instance between game nights if you want to stretch credits; the
  static IP stays attached (on EC2, an unattached Elastic IP is billed).
- `render.yaml` still works as a free fallback — see the README section on
  deploying a public link.
