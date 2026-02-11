import { hash } from "bun"

type ONOFF = "ON" | "OFF"

export interface BaseElacState {
  POWER: ONOFF
  MUTE: ONOFF
  VOLUME: number // 0~100
  BASS: number // -6~6
  TREBLE: number // -6~6
}

export enum ElacInput {
  Rca = "RCA",
  Optical = "OPTICAL",
  Bluetooth = "BLUETOOTH",
  Analog1 = "ANALOG1",
  Analog2 = "ANALOG2",
  Coaxical = "COAX",
  Stream = "STREAM",
  // Next = "NEXT": OPcode only
}

export interface ElacStatus {
  NAME: string
  MODEL: string
  IP: string
  MAC: string
  POWER: ONOFF
  UNIT: "OK" | "FAULT"
}

export interface SoftwareInfo {
  os_ver_mach: number //100000049
  os_ver_display: string
  os_branch: string // stable
  valid: boolean
}

export interface CGIInfo {
  white: number
  volume: number
  bass: number
  treble: number
  serial_number: string
  friendly_name: string
  local: SoftwareInfo
  latest: SoftwareInfo
  wakeup_on_audio: boolean
  TCP_port_1: number
  TCP_port_2: number
  TCP_port_3: number
  eth_always_on: boolean
}

export type Amp340ElacInput =
  | ElacInput.Rca
  | ElacInput.Optical
  | ElacInput.Bluetooth
export type A101gElacInput = Exclude<ElacInput, ElacInput.Rca>
export const A101gElacInputOrder: A101gElacInput[] = [
  ElacInput.Analog1,
  ElacInput.Analog2,
  ElacInput.Optical,
  ElacInput.Coaxical,
  ElacInput.Stream,
]

type SubElacState = BaseElacState & {
  SUB_VOLUME: number // -12 ~ 12
  STATUS: string
}

export type Amp340ElacState = SubElacState & {
  CENTER_VOLUME: number // -12~12
  BALANCE: number // -100~100
  PRESET: "MUSIC" | "MOVIE" | "NIGHT"
  INPUT: Amp340ElacInput
}

export type A101gElacState = SubElacState & {
  INPUT: A101gElacInput
}

export function parseStatus(statusStr: string) {
  const kvPair = statusStr.split(",")
  const elacStatus: ElacStatus = Object.create(null)
  for (const kvStr of kvPair) {
    const { key, value } = parseKeyValue(kvStr)
    if (value === null) {
      continue
    }
    ;(elacStatus as unknown as Record<string, string>)[key] = value
  }

  return elacStatus
}

export function parseKeyValue(kvStr: string): {
  key: string
  value: string | null
} {
  const eqPos = kvStr.indexOf("=")
  if (eqPos < 0) {
    // Invalid key-value
    return {
      key: kvStr,
      value: null,
    }
  }
  const key = kvStr.substring(0, eqPos)
  const value = kvStr.substring(eqPos + 1)

  return {
    key,
    value,
  }
}

type ReplyReturn = {
  type: string
  key: string
  value: string | null
}

export function parseReply(reply: string): ReplyReturn {
  const endPos = reply.indexOf("\r")
  if (endPos !== reply.length - 1) {
    throw new Error("Reply must end with \\r!")
  }
  const sepPos = reply.indexOf(":")

  if (sepPos < 0) {
    throw new Error("Reply must have ':'!")
  }
  const type = reply.substring(0, sepPos)

  const eqPos = reply.indexOf("=")
  if (eqPos < 0) {
    // No value
    return {
      type,
      key: reply.substring(sepPos + 1, endPos),
      value: null,
    }
  }

  const key = reply.substring(sepPos + 1, eqPos)
  const value = reply.substring(eqPos + 1, endPos)

  return {
    type,
    key,
    value,
  }
}

export function onOffStr(isOn: boolean) {
  return isOn ? "ON" : "OFF"
}

export async function fetchCGIInfo(ip: string) {
  const commands: string[] = [
    "led",
    "volume",
    "bass",
    "treble",
    "serial_number",
    "friendly_name",
    "version_info",
    "wakeup_on_audio",
    "ecc_tcp_port1",
    "ecc_tcp_port2",
    "ecc_tcp_port3",
    "eth_always_on",
  ]
  const encodedCmds = encodeURIComponent(commands.join(","))
  const url = `http://${ip}/cgi-bin/load_settings.cgi?cmd=${encodedCmds}`

  const resp = await fetch(url)
  const respJson = await resp.json()

  return respJson as CGIInfo
}

export function hash6(str: string) {
  const hashed = (BigInt(hash(`${str}_matter-Elac`)) % 2176782336n).toString(36)
  return hashed.padStart(6, "0")
}

export function clampSWVersion(swVersion: number) {
  const majorVer = Math.floor(swVersion / 100000000)
  const revision = swVersion % 1000
  return majorVer * 1000 + revision
}

export function getInputIndex(input: string) {
  switch (input) {
    case "ANALOG1":
      return 1
    case "ANALOG2":
      return 2
    case "OPTICAL":
      return 3
    case "COAX":
      return 4
    case "BLUETOOTH":
    case "STREAM":
      return 5
    default:
      return 5
  }
}
