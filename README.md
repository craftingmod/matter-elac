# Matter-Elac

![Project Thumbnail](./public/thumb.avif)

Matter bridge for ELAC DS-A101-G.

Currently, only DS-A101-G is supported.

## Customize

`ELAC_IP` Environment must be set. (Check `DS-A101-G` app to find ip of amp.)

Go to `http://<ELAC_IP>/` and turning on `Ethernet always ON` is highly recommended.

- Ports

1.  `5502`: QR Paring web port(TCP). Can be customized by `WEB_PORT` env.
2.  `5542`: Matter port(TCP/UDP). Can be customized by `MATTER_PORT` env.
3.  `5353`: Matter mDNS port(UDP). Must be used `5353` port.

## Quick Start (Docker)

The easiest way to run the bridge is using the pre-built Docker image from the GitHub Container Registry.

*Note: `--network host` is required for mDNS discovery to work properly.*

```bash
# Provide your ELAC amplifier's IP address
export ELAC_IP="192.168.x.x"

# Run the bridge
docker run -d --name elac-bridge \
  --restart always \
  --network host \
  -v elac-matter-data:/usr/src/app/data \
  -e ELAC_IP=$ELAC_IP \
  ghcr.io/craftingmod/matter-elac:latest
```

## Pairing with SmartThings (or other Matter controllers)

1. Open your web browser and go to: `http://<YOUR_DOCKER_HOST_IP>:5502/`
2. You will see a Matter pairing QR code.
3. Open the SmartThings app, tap "Add device", and scan the QR code.

### SmartThings Edge Driver
To use the custom features of the ELAC amplifier, you need to install the custom edge driver *before* pairing.
1. Click the invitation link: [SmartThings Edge Driver Invite](https://bestow-regional.api.smartthings.com/invite/d4294nK49bMo)
2. Enroll your hub and install the `ELAC Matter` driver.
3. *Note: This driver only provides the UI/Capabilities; the Docker bridge above MUST be running for it to work.*

---

## Advanced Configurations

### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `ELAC_IP` | **Required** | The IP address of your DS-A101-G amplifier. |
| `MATTER_PORT` | `5542` | The Matter communication port (TCP/UDP). |
| `WEB_PORT` | `5502` | The port for the pairing QR code web page (TCP). |

*Note: The mDNS port (`5353/UDP`) is fixed by protocol standards.*

### Build Manually
If you want to modify the source code or build the image yourself:

```bash
git clone https://github.com/craftingmod/matter-elac.git
cd matter-elac
docker build -t matter-elac .
```

### Manual Run (Without Docker)
```bash
bun install
export ELAC_IP="192.168.x.x"
bun run ./src/index.ts
```

## Reference

1. [ELAC Ethernet Control Protocol](https://elacsound.nl/wp-content/uploads/2022/10/Elac-Ethernet-Control-Protocol.xlsx)
2. [matter.js](https://github.com/matter-js/matter.js)
3. Gemini NanoBanana for thumbnail
