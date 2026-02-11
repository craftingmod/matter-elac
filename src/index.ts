import "./LogConfig.ts"
import {
  BasicVideoPlayerDevice,
  OnOffPlugInUnitDevice,
  SpeakerDevice,
} from "@matter/main/devices"
import { ServerNode, VendorId } from "@matter/main"
import { A101gClient } from "./elac/A101gClient.ts"
import { clampSWVersion, fetchCGIInfo, hash6 } from "./elac/ElacFetch.ts"
import { ChocoLogger } from "choco-logger"
import {
  createKeypadServer,
  createMediaInputServer,
  createPowerServer,
  createVolumeServer,
  syncElacState,
} from "./matter/ElacMatterServer.ts"
import { DummyMediaPlaybackServer } from "./matter/DummyServer.ts"

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

const serialHash = hash6(cgiInfo.serial_number)

const { MuteServer, VolumeServer } = createVolumeServer(elacClient)
const { InputSourceServer } = createMediaInputServer(elacClient)
const { PowerServer } = createPowerServer(elacClient)
const { KeypadServer } = createKeypadServer(elacClient)

const PowerDevice = OnOffPlugInUnitDevice.with(PowerServer)

const MuteDevice = OnOffPlugInUnitDevice.with(MuteServer)

const VolumeDevice = SpeakerDevice.with(MuteServer, VolumeServer)

const KeypadInputDevice = BasicVideoPlayerDevice.with(
  PowerServer,
  DummyMediaPlaybackServer,
  KeypadServer,
  InputSourceServer,
)

const rootNode = await ServerNode.create({
  id: `elac-matter-${serialHash}`,
  basicInformation: {
    hardwareVersion: clampSWVersion(cgiInfo.local.os_ver_mach),
    softwareVersion: 1001,
    vendorName: "ELAC",
    productName: "ELAC DS-A101-G",
    vendorId: VendorId(0xfff1),
    productId: 0xac11,
    serialNumber: cgiInfo.serial_number,
    nodeLabel: cgiInfo.friendly_name,
  },
})

const powerEndpoint = await rootNode.add(PowerDevice, {
  id: "power-toggle",
})

const muteEndpoint = await rootNode.add(MuteDevice, {
  id: "mute-toggle",
})

const volumeEndpoint = await rootNode.add(VolumeDevice, {
  id: "volume-slider",
})

const keypadEndpoint = await rootNode.add(KeypadInputDevice, {
  id: "keypad-inputsource-switch",
})

syncElacState(elacClient, {
  power: [powerEndpoint, keypadEndpoint],
  mute: [muteEndpoint, volumeEndpoint],
  volume: volumeEndpoint,
  media: keypadEndpoint,
})

await rootNode.start()
