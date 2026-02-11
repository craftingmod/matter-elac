import { ChocoLogger } from "choco-logger"

ChocoLogger.configure({
  defaultNamespace: "matter-elac",
})

export const Logger = new ChocoLogger("Global")
