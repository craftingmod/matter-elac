import {
  onOffStr,
  type A101gElacInput,
  type A101gElacState,
} from "./ElacFetch.ts"
import { ElacTCPClient } from "./ElacTCPClient.ts"

export class A101gClient extends ElacTCPClient<A101gElacState> {
  private static readonly SAFE_VOLUME_LIMIT = 35

  public get power() {
    return this.states.POWER === "ON"
  }
  public get mute() {
    return this.states.MUTE === "ON"
  }

  public get volume() {
    return Number(this.states.VOLUME)
  }

  public get humanVolume() {
    return this.mute ? 0 : Number(this.states.VOLUME)
  }

  /**
   * Sub Volume
   *
   * 0 ~ 100
   */
  public get subVolume() {
    return Number(this.states.SUB_VOLUME)
  }

  public get bass() {
    return Number(this.states.BASS)
  }

  public get treble() {
    return Number(this.states.TREBLE)
  }

  public get input() {
    return this.states.INPUT as A101gElacInput
  }

  public get name() {
    return this.status?.NAME ?? ""
  }

  public get model() {
    return this.status?.MODEL ?? ""
  }

  public get deviceIP() {
    return this.status?.IP ?? ""
  }

  public get deviceMac() {
    return this.status?.MAC ?? ""
  }

  public get unit(): "OK" | "FAULT" {
    return this.status?.UNIT ?? "FAULT"
  }

  public async setPower(powerOn: boolean) {
    if (this.power !== powerOn) {
      await this.sendAndWait("POWER", onOffStr(powerOn))
    }
  }

  public async setVolume(volume: number) {
    const volumeLimit = Math.min(100, A101gClient.SAFE_VOLUME_LIMIT)
    if (volume < 0) {
      volume = 0
    } else if (volume > volumeLimit) {
      volume = volumeLimit
    }
    volume = Math.floor(volume)

    if (this.volume !== volume) {
      await this.sendAndWait("VOLUME", String(volume))
    }
  }

  public async setMute(mute: boolean) {
    if (this.mute !== mute) {
      await this.sendAndWait("MUTE", onOffStr(mute))
    }
  }

  public async setInput(inputType: A101gElacInput) {
    if (this.input !== inputType) {
      await this.sendAndWait("INPUT", inputType)
    }
  }
}
