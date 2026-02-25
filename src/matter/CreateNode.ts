import type { A101gClient } from "../elac/A101gClient.ts"
import {
  BasicVideoPlayerDevice,
  ModeSelectDevice,
  OnOffPlugInUnitDevice,
  SpeakerDevice,
} from "@matter/main/devices"
import { ServerNode, VendorId } from "@matter/main"
import {
  clampSWVersion,
  fetchCGIInfo,
  hash6,
  type CGIInfo,
} from "../elac/ElacFetch.ts"
import {
  createKeypadServer,
  createMediaInputServer,
  createPowerServer,
  createVolumeServer,
  createInputSelectServer,
  syncElacState,
} from "./ElacMatterServer.ts"
import { DummyMediaPlaybackServer } from "./DummyServer.ts"

export async function createRootNode(
  elacClient: A101gClient,
  cgiInfo: CGIInfo,
) {
  // Create Servers
  const {
    MuteServer,
    VolumeServer,
    InputSourceServer,
    PowerServer,
    KeypadServer,
    InputSelectServer,
  } = createServers(elacClient)

  // Create Devices
  const PowerDevice = OnOffPlugInUnitDevice.with(PowerServer)
  const MuteDevice = OnOffPlugInUnitDevice.with(MuteServer)
  const VolumeDevice = SpeakerDevice.with(MuteServer, VolumeServer)
  const KeypadInputDevice = BasicVideoPlayerDevice.with(
    PowerServer,
    DummyMediaPlaybackServer,
    KeypadServer,
    InputSourceServer,
  )
  const InputSelectDevice = ModeSelectDevice.with(InputSelectServer)

  const serialHash = hash6(cgiInfo.serial_number)
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

  const inputSelectEndpoint = await rootNode.add(InputSelectDevice, {
    id: "select-inputsource",
  })

  syncElacState(elacClient, {
    power: [powerEndpoint, keypadEndpoint],
    mute: [muteEndpoint, volumeEndpoint],
    volume: volumeEndpoint,
    media: keypadEndpoint,
    modeSelect: inputSelectEndpoint,
  })

  await rootNode.start()

  return rootNode
}

function createServers(elacClient: A101gClient) {
  return {
    ...createVolumeServer(elacClient),
    ...createMediaInputServer(elacClient),
    ...createPowerServer(elacClient),
    ...createKeypadServer(elacClient),
    ...createInputSelectServer(elacClient),
  }
}
