import Bun, { type Socket } from "bun"
import { TypedEmitter } from "tiny-typed-emitter"
import { ChocoLogger } from "choco-logger"
import { parseReply, parseStatus, type ElacStatus } from "./ElacFetch.ts"

const Log = new ChocoLogger("TCPClient")

const SOCKET_NOT_INIT = "Socket is not initialized!"

type RawValue = string | number | boolean

type MaybePromise<T> = Promise<T> | T

interface ElacEvent {
  stateUpdate: (
    key: string,
    value: string,
    oldValue: string | null,
  ) => MaybePromise<void>
  statusUpdate: (status: ElacStatus) => MaybePromise<void>
  ackCommand: (
    command: string,
    success: boolean,
    value: string | null,
  ) => MaybePromise<void>
  initialized: () => MaybePromise<void>
}

export type StringValue<T> = {
  [K in keyof T]: string
}

export class ElacTCPClient<
  T extends Record<never, string | number>,
> extends TypedEmitter<ElacEvent> {
  private socket: Socket | null = null

  protected states: StringValue<T> = Object.create(null)
  protected status: ElacStatus | null = null

  public constructor(
    protected readonly ip: string,
    protected readonly port: number,
  ) {
    super()
  }

  public async connect() {
    this.socket = await Bun.connect({
      hostname: this.ip,
      port: this.port,

      socket: {
        open: () => {
          Log.info(`Socket connected: ${this.ip}:${this.port}`)
          // Initialze event once
          this.once("statusUpdate", () => {
            this.emit("initialized")
          })
        },
        data: async (socket, data) => {
          await this.onData(socket, data)
        },
      },
    })
  }

  public async initialize() {
    await this.connect()
    await this.waitEvent(
      "initialized",
      (res) => {
        return () => {
          res()
        }
      },
      5000,
    )
  }

  protected async waitEvent<T extends keyof ElacEvent>(
    eventName: T,
    createFn: (
      resolve: () => void,
      reject: (reason: unknown) => void,
    ) => ElacEvent[T],
    timeoutMs: number = 5000,
  ) {
    return new Promise<void>((resolve, reject) => {
      const ac = new AbortController()
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = AbortSignal.any([ac.signal, timeoutSignal])

      let resolveFn: ElacEvent[T]

      signal.addEventListener(
        "abort",
        () => {
          this.off(eventName, resolveFn)
          if (timeoutSignal.aborted) {
            reject(
              new Error(`Waiting "${eventName}" with condition is timed out!`),
            )
          }
        },
        { once: true },
      )

      resolveFn = createFn(
        () => {
          ac.abort()
          resolve()
        },
        (reason: unknown) => {
          ac.abort()
          reject(reason)
        },
      )
      this.on(eventName, resolveFn)
    })
  }

  protected async onData(socket: Socket, data: Uint8Array) {
    Log.verbose(`Socket input: ${data.toString()}`)

    const strData = data.toString()
    const parsedData = parseReply(strData)

    if (parsedData.type === "UPD") {
      if (parsedData.value === null) {
        throw new Error("Command value must not be null!")
      }

      this.updateStates(parsedData.key, parsedData.value)
      return
    }

    if (parsedData.type === "ACK") {
      if (parsedData.value === null) {
        throw new Error("Command value must not be null!")
      }

      this.emit("ackCommand", parsedData.key, true, parsedData.value)
      // ACK also update states
      this.updateStates(parsedData.key, parsedData.value)
      return
    }

    if (parsedData.type === "NACK") {
      this.emit("ackCommand", parsedData.key, false, null)
      return
    }
  }

  protected updateStates(key: string, value: string) {
    Log.debug(`[SetState] ${key}: ${value}`)
    const oldValue = (this.states as Record<string, string>)[key] ?? null
    // key should be keyof states
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this.states as any)[key] = value

    if (key === "STATUS") {
      const status = parseStatus(value)
      this.status = status
      this.emit("statusUpdate", status)
    }
    this.emit("stateUpdate", key, value, oldValue)
  }

  protected sendMany(commands: Record<string, RawValue | RawValue[]>) {
    if (this.socket === null) {
      throw new Error(SOCKET_NOT_INIT)
    }

    const formattedCommands = Object.entries(commands).map(([key, value]) => {
      if (Array.isArray(value)) {
        value = value.map((v) => String(v).trim()).join(",")
      } else {
        value = String(value).trim()
      }
      return `${key.trim().toUpperCase()}:${value.toUpperCase()}\r`
    })

    if (formattedCommands.length <= 0) {
      Log.warning(`No command input is in!`)
      return
    }

    this.socket.write(formattedCommands.join(""))
  }

  public sendOne(command: string, value: RawValue | RawValue[]) {
    if (this.socket === null) {
      throw new Error(SOCKET_NOT_INIT)
    }

    if (Array.isArray(value)) {
      value = value.map((v) => String(v).trim()).join(",")
    } else {
      value = String(value).trim()
    }
    const writeContent = `${command.trim().toUpperCase()}:${value.toUpperCase()}\r`

    Log.debug(`Socket write:`, writeContent)

    this.socket.write(writeContent)
  }

  public async sendAndWait(command: string, value: RawValue | RawValue[]) {
    this.sendOne(command, value)
    await this.waitEvent("ackCommand", (res, rej) => {
      return (ackCmd, success) => {
        if (ackCmd !== command) {
          return
        }
        if (success) {
          res()
          return
        }
        rej(new Error("ACK failed!"))
      }
    })
  }
}
