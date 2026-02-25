export function getPort(portStr: string | undefined, dfValue: number) {
  if (portStr != null) {
    const localPort = Number(portStr)
    if (Number.isNaN(localPort) || localPort <= 1000 || localPort > 65500) {
      return dfValue
    }
    return localPort
  }
  return dfValue
}
