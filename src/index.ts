import "./LogConfig.ts"
import { A101gClient } from "./elac/A101gClient.ts"
import { fetchCGIInfo } from "./elac/ElacFetch.ts"
import { ChocoLogger } from "choco-logger"
import { serve } from "bun"
import { createRootNode } from "./matter/CreateNode.ts"
import Path from "node:path"
import encodeQR from "qr"

const Log = new ChocoLogger("Main")

if (process.env.ELAC_IP === undefined) {
  throw new Error("Environment ELAC_IP must need to run!")
}

const cgiInfo = await fetchCGIInfo(process.env.ELAC_IP)
Log.debug("CGI Info: ", cgiInfo)
Log.info(`ethernet port: ${cgiInfo.TCP_port_1}`)

const elacClient = new A101gClient(
  process.env.ELAC_IP,
  Number(process.env.ELAC_PORT) ?? cgiInfo.TCP_port_1,
)

await elacClient.initialize()

const rootNode = await createRootNode(elacClient, cgiInfo)

// Hosting QR Code for pairing

const getResource = (path: string) =>
  Bun.file(Path.resolve(import.meta.dir, "../public", path))
serve({
  port: 5500,
  routes: {
    "/": getResource("index.html"),
    "/favicon.svg": getResource("favicon.svg"),
    "/qrimage": () => {
      const svgHeader = {
        "Content-Type": "image/svg+xml; charset=utf-8",
      }
      if (rootNode.lifecycle.isCommissioned) {
        const file = getResource("comissioned.svg")
        return new Response(file, {
          headers: svgHeader,
        })
      }

      const { qrPairingCode } = rootNode.state.commissioning.pairingCodes

      return new Response(encodeQR(qrPairingCode, "svg"), {
        headers: svgHeader,
      })
    },
    "/pairingcode": () => {
      const plainHeader = {
        "Content-Type": "text/plain; charset=utf-8",
      }
      if (rootNode.lifecycle.isCommissioned) {
        return new Response("comissioned", {
          headers: plainHeader,
        })
      }

      const { manualPairingCode } = rootNode.state.commissioning.pairingCodes
      return new Response(manualPairingCode, {
        headers: plainHeader,
      })
    },
  },
})

Log.info(`Pairing page is opened at port 5500!`)
Log.debug(`Pairing page (Local only):`, `http://localhost:5500/`)
