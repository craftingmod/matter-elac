import Bun from "bun"
import { mkdir } from "node:fs/promises"
import Path from "node:path"

const libsDir = Path.resolve(import.meta.dir)

const response = await fetch(
  "https://github.com/SmartThingsCommunity/SmartThingsEdgeDrivers/releases/download/apiv16_59/lua_libs-api_v16_59X.tar.gz",
)

if (response.status !== 200) {
  throw new Error(`Response status is not 200!`)
}

const luaLibGzip = await response.arrayBuffer()

const luaLibTar = Bun.gunzipSync(luaLibGzip)

const luaLibPath = Path.resolve(libsDir, "st-lua-libs.tar")
const luaLibExtractPath = Path.resolve(libsDir, "st-lua")
await mkdir(luaLibExtractPath, { recursive: true })

await Bun.write(luaLibPath, luaLibTar)

await Bun.spawn(["tar", "-xf", luaLibPath, "-C", luaLibExtractPath]).exited

console.log("SmartThings Lua library fetched!")
