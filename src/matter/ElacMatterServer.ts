import type { A101gClient } from "../elac/A101gClient.ts"
import {
  KeypadInputServer,
  LevelControlServer,
  MediaInputServer,
  ModeSelectServer,
  OnOffServer,
} from "@matter/main/behaviors"
import { InputType } from "./MatterTypes.ts"
import {
  A101gElacInputOrder,
  ElacInput,
  getInputIndex,
  type A101gElacInput,
} from "../elac/ElacFetch.ts"
import { KeypadInput, ModeSelect, type MediaInput } from "@matter/main/clusters"
import type { MaybePromise, Endpoint } from "@matter/main"
import { ChocoLogger } from "choco-logger"

const Log = new ChocoLogger("ElacMatterServer")

export function createVolumeServer(elacClient: A101gClient) {
  const MuteServer = class extends OnOffServer {
    override async on() {
      await elacClient.setMute(true)
    }
    override async off() {
      await elacClient.setMute(false)
    }
  }

  const VolumeServer = class extends LevelControlServer {
    private readonly maxValue = 254

    override async transition(targetLevel?: number) {
      if (targetLevel == null) {
        return
      }

      // Ignore transaction (There already has a delay..)
      // Map Matter 0-254 to Elac 0-100
      const targetVolume = Math.round((targetLevel * 100) / this.maxValue)
      await elacClient.setVolume(targetVolume)
    }

    override handleOnOffChange(): MaybePromise {
      // Typically handled by MuteServer
    }
  }

  return {
    MuteServer,
    VolumeServer,
  }
}

export function createMediaInputServer(elacClient: A101gClient) {
  const InputSourceServer = class extends MediaInputServer {
    private deviceType: A101gElacInput[] = []

    override initialize() {
      this.deviceType = [ElacInput.Stream, ...A101gElacInputOrder]
      this.state.inputList = [
        {
          index: 1,
          inputType: InputType.Line,
          name: "Analog1",
          description: "Red & White RCA port next to power cable.",
        },
        {
          index: 2,
          inputType: InputType.Line,
          name: "Analog2",
          description: "Red & White RCA port named as 'LINE 2 IN'.",
        },
        {
          index: 3,
          inputType: InputType.Optical,
          name: "Optical",
          description: "Black square optical port named as 'OPTICAL IN'.",
        },
        {
          index: 4,
          inputType: InputType.Coax,
          name: "Coaxial",
          description: "Coaxial port up to 'COAX IN'.",
        },
        {
          index: 5,
          inputType: InputType.Internal,
          name: "Streaming",
          description: "Streaming/Bluetooth input like Spotify, Airplay, etc.",
        },
      ]
      this.state.currentInput = getInputIndex(elacClient.input)
    }

    override async selectInput(request: MediaInput.SelectInputRequest) {
      const inputType = this.deviceType[request.index] ?? ElacInput.Stream
      await elacClient.setInput(inputType)
    }

    override showInputStatus() {
      // Nothing to implement
    }

    override hideInputStatus() {
      // Nothing to implement
    }
  }

  return {
    InputSourceServer,
  }
}

export function createInputSelectServer(elacClient: A101gClient) {
  const InputSelectServer = class extends ModeSelectServer {
    override initialize() {
      // Input Sources
      this.state.supportedModes = [
        { label: "Analog 1", mode: 1, semanticTags: [] },
        { label: "Analog 2", mode: 2, semanticTags: [] },
        { label: "Optical", mode: 3, semanticTags: [] },
        { label: "Coaxial", mode: 4, semanticTags: [] },
        { label: "Streaming", mode: 5, semanticTags: [] },
      ]
      this.state.description = "Select Input Source"

      this.state.currentMode = getInputIndex(elacClient.input)
    }

    override async changeToMode(request: ModeSelect.ChangeToModeRequest) {
      const deviceType: A101gElacInput[] = [
        ElacInput.Stream,
        ...A101gElacInputOrder,
      ]
      const inputType = deviceType[Number(request.newMode)] ?? ElacInput.Stream

      await elacClient.setInput(inputType)
    }
  }

  return {
    InputSelectServer,
  }
}

export function createPowerServer(elacClient: A101gClient) {
  const PowerServer = class extends OnOffServer {
    override initialize() {
      this.state.onOff = elacClient.power
    }
    override async on() {
      await elacClient.setPower(true)
    }
    override async off() {
      await elacClient.setPower(false)
    }
  }

  return {
    PowerServer,
  }
}

const { CecKeyCode: KeyCode } = KeypadInput

export function createKeypadServer(elacClient: A101gClient) {
  const KeypadServer = class extends KeypadInputServer {
    override async sendKey(request: KeypadInput.SendKeyRequest) {
      const keyCode = request.keyCode

      switch (keyCode) {
        case KeyCode.Right:
        case KeyCode.SelectAudioInputFunction:
        case KeyCode.InputSelect:
          const currentIndex = A101gElacInputOrder.indexOf(elacClient.input)
          const nextInput =
            A101gElacInputOrder[
              (currentIndex + 1) % A101gElacInputOrder.length
            ]!
          await elacClient.setInput(nextInput)
          break
        case KeyCode.Left:
          const currentIndexPrev = A101gElacInputOrder.indexOf(elacClient.input)
          const prevIndex = currentIndexPrev - 1 + A101gElacInputOrder.length
          const prevInput =
            A101gElacInputOrder[prevIndex % A101gElacInputOrder.length]!
          await elacClient.setInput(prevInput)
          break
        case KeyCode.Numbers1:
          await elacClient.setInput(ElacInput.Analog1)
          break
        case KeyCode.Numbers2:
          await elacClient.setInput(ElacInput.Analog2)
          break
        case KeyCode.Numbers3:
          await elacClient.setInput(ElacInput.Optical)
          break
        case KeyCode.Numbers4:
          await elacClient.setInput(ElacInput.Coaxical)
          break
        case KeyCode.Numbers5:
          await elacClient.setInput(ElacInput.Stream)
          break
        case KeyCode.SelectMediaFunction:
          await elacClient.setInput(ElacInput.Stream)
          break

        case KeyCode.PowerToggleFunction:
        case KeyCode.Power:
          await elacClient.setPower(!elacClient.power)
          break
        case KeyCode.Up:
        case KeyCode.VolumeUp:
          await elacClient.setMute(false)
          await elacClient.setVolume(elacClient.volume + 3) // +3 in 0~100
          break
        case KeyCode.Down:
        case KeyCode.VolumeDown:
          await elacClient.setVolume(elacClient.volume - 3) // -3 in 0~100
          break
        case KeyCode.Mute:
          await elacClient.setMute(!elacClient.mute)
          break

        case KeyCode.PowerOnFunction:
          await elacClient.setPower(true)
          break
        case KeyCode.PowerOffFunction:
          await elacClient.setPower(false)
          break
        case KeyCode.MuteFunction:
          await elacClient.setMute(true)
          break
        case KeyCode.RestoreVolumeFunction:
          await elacClient.setMute(false)
          break
        default:
          Log.warning(`[Keypad] Unsupported key: ${keyCode}`)
      }

      return {
        status: KeypadInput.Status.Success,
      }
    }
  }

  return {
    KeypadServer,
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function syncElacState(
  elacClient: A101gClient,
  endpoints: Partial<{
    power: Endpoint<any> | Endpoint<any>[]
    mute: Endpoint<any> | Endpoint<any>[]
    volume: Endpoint<any> | Endpoint<any>[]
    media: Endpoint<any> | Endpoint<any>[]
    modeSelect: Endpoint<any> | Endpoint<any>[]
  }>,
) {
  const maxValue = 254
  const wrapArray = <T>(value: T | T[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value]

  const { power, mute, volume, media, modeSelect } = {
    power: wrapArray(endpoints.power),
    mute: wrapArray(endpoints.mute),
    volume: wrapArray(endpoints.volume),
    media: wrapArray(endpoints.media),
    modeSelect: wrapArray(endpoints.modeSelect),
  }

  const onStateUpdate = async (key: string, value: string) => {
    try {
      switch (key) {
        case "POWER":
          const isOn = value === "ON"
          for (const e of power) {
            await e.set({ onOff: { onOff: isOn } })
          }
          break
        case "MUTE":
          const isMuted = value === "ON"
          for (const e of mute) {
            await e.set({ onOff: { onOff: isMuted } })
          }
          break
        case "VOLUME":
          const matterLevel = Math.round((Number(value) * maxValue) / 100)
          for (const e of volume) {
            await e.set({ levelControl: { currentLevel: matterLevel } })
          }
          break
        case "INPUT":
          const inputIndex = getInputIndex(value)
          for (const e of media) {
            await e.set({ mediaInput: { currentInput: inputIndex } })
          }
          for (const e of modeSelect) {
            await e.set({ modeSelect: { currentMode: inputIndex } })
          }
          break
      }
    } catch (error) {
      Log.warning(`[syncElacState] Failed to update "${key}":`, error)
    }
  }

  elacClient.on("stateUpdate", onStateUpdate)

  return {
    unsubscribe: () => elacClient.off("stateUpdate", onStateUpdate),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
