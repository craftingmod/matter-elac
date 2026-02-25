-- ELAC DS-A101-G SmartThings Edge Driver (Matter)
-- Mirrors the endpoint/cluster layout defined in src/index.ts:
--
--   EP1 (power-toggle)          : OnOffPlugInUnitDevice  + PowerServer
--   EP2 (mute-toggle)           : OnOffPlugInUnitDevice  + MuteServer
--   EP3 (volume-slider)         : SpeakerDevice          + MuteServer + VolumeServer  (LevelControl)
--   EP4 (keypad-inputsource)    : BasicVideoPlayerDevice + PowerServer + KeypadInputServer
--   EP5 (select-inputsource)    : ModeSelectDevice + InputSelectServer
--
-- Profile: elac-amp.yml  (single "main" component)
--   Capabilities: switch, audioVolume, audioMute, mediaInputSource, keypadInput
--
-- NOTE: MediaInputSource capability uses the ModeSelect (0x0050) cluster
--       for bidirectional sync, avoiding Hub limitations with MediaInput (0x0507).
--
-- Written by LLM

local capabilities = require "st.capabilities"
local clusters     = require "st.matter.clusters"
local MatterDriver = require "st.matter.driver"

--------------------------------------------------------------------------------
-- Constants
--------------------------------------------------------------------------------
local VOLUME_STEP = 5

-- Input sources — order and indices MUST match ElacMatterServer.ts → inputList
-- (index = position in this table, i.e. 1-based to match Matter currentInput)
local INPUT_SOURCES = {
  { id = "analog1",   name = "Analog1",   index = 1 },
  { id = "analog2",   name = "Analog2",   index = 2 },
  { id = "optical",   name = "Optical",   index = 3 },
  { id = "coaxial",   name = "Coaxial",   index = 4 },
  { id = "network", name = "Streaming", index = 5 },
}

-- Lookup: SmartThings inputSource id  →  Matter MediaInput index (1-based)
local INPUT_ID_TO_INDEX = {}
for _, src in ipairs(INPUT_SOURCES) do
  INPUT_ID_TO_INDEX[src.id] = src.index
end

-- Device field keys (persisted per-device)
local POWER_EP  = "power_ep"
local MUTE_EP   = "mute_ep"
local VOLUME_EP = "volume_ep"
local KEYPAD_EP = "keypad_ep"
local SELECT_EP = "select_ep"

--------------------------------------------------------------------------------
-- Endpoint Discovery
--
-- index.ts adds endpoints in this order, so they get increasing EP numbers:
--   EP1: power-toggle   (OnOff only, no LevelControl, no KeypadInput)
--   EP2: mute-toggle    (OnOff only, no LevelControl, no KeypadInput)
--   EP3: volume-slider  (OnOff + LevelControl)
--   EP4: keypad-input   (OnOff + KeypadInput + MediaInput)
--
-- Strategy:
--   • EP with LevelControl               → volume_ep (EP3)
--   • EP with KeypadInput                → keypad_ep (EP4)
--   • EP with ModeSelect                 → select_ep (EP5)
--   • Remaining "pure" OnOff EPs sorted  → [1]=power_ep, [2]=mute_ep
--------------------------------------------------------------------------------
local function discover_endpoints(device)
  local onoff_eps  = device:get_endpoints(clusters.OnOff.ID)
  local level_eps  = device:get_endpoints(clusters.LevelControl.ID)
  local keypad_eps = device:get_endpoints(clusters.KeypadInput.ID)
  local mode_eps   = device:get_endpoints(clusters.ModeSelect.ID)

  -- Build O(1) lookup sets
  local level_set, keypad_set, mode_set = {}, {}, {}
  for _, ep in ipairs(level_eps)  do level_set[ep]  = true end
  for _, ep in ipairs(keypad_eps) do keypad_set[ep] = true end
  for _, ep in ipairs(mode_eps)   do mode_set[ep]   = true end

  -- EP3 — first endpoint that has LevelControl (volume)
  local volume_ep = level_eps[1] or device.MATTER_DEFAULT_ENDPOINT

  -- EP4 — first endpoint that has KeypadInput
  local keypad_ep = keypad_eps[1]   -- may be nil if device doesn't expose it

  -- EP5 — first endpoint that has ModeSelect
  local select_ep = mode_eps[1]

  -- Pure OnOff endpoints: OnOff cluster but NOT LevelControl, NOT KeypadInput, NOT ModeSelect, NOT root EP 0
  local pure_onoff = {}
  for _, ep in ipairs(onoff_eps) do
    if ep ~= 0 and not level_set[ep] and not keypad_set[ep] and not mode_set[ep] then
      table.insert(pure_onoff, ep)
    end
  end
  table.sort(pure_onoff)  -- ascending → EP1 first, EP2 second

  local power_ep = pure_onoff[1] or device.MATTER_DEFAULT_ENDPOINT
  local mute_ep  = pure_onoff[2] or power_ep   -- fallback to same EP if only one exists

  return power_ep, mute_ep, volume_ep, keypad_ep, select_ep
end

--------------------------------------------------------------------------------
-- Active Read Helper
--
-- After subscribe(), explicitly READ each attribute on each target endpoint.
-- The read response flows through matter_handlers.attr exactly like a
-- subscription report, giving us the actual current values immediately.
--------------------------------------------------------------------------------
local function read_current_state(device)
  local power_ep  = device:get_field(POWER_EP)
  local mute_ep   = device:get_field(MUTE_EP)
  local volume_ep = device:get_field(VOLUME_EP)
  local keypad_ep = device:get_field(KEYPAD_EP)
  local select_ep = device:get_field(SELECT_EP)

  -- Power endpoint (EP1) — OnOff
  if power_ep then
    device:send(clusters.OnOff.attributes.OnOff:read(device, power_ep))
  end

  -- Mute endpoint (EP2) — OnOff
  if mute_ep and mute_ep ~= power_ep then
    device:send(clusters.OnOff.attributes.OnOff:read(device, mute_ep))
  end

  -- Volume endpoint (EP3) — OnOff (mute mirror) + LevelControl
  if volume_ep then
    device:send(clusters.OnOff.attributes.OnOff:read(device, volume_ep))
    device:send(clusters.LevelControl.attributes.CurrentLevel:read(device, volume_ep))
  end

  -- Keypad endpoint (EP4) — OnOff (power mirror)
  if keypad_ep then
    device:send(clusters.OnOff.attributes.OnOff:read(device, keypad_ep))
  end

  -- Select endpoint (EP5) — ModeSelect
  if select_ep then
    device:send(clusters.ModeSelect.attributes.CurrentMode:read(device, select_ep))
  end

  device.log.info("[elac-amp] Sent initial attribute reads for all endpoints")
end

--------------------------------------------------------------------------------
-- Lifecycle: doConfigure  (called after Matter commissioning)
--------------------------------------------------------------------------------
local function configure_handler(driver, device)
  -- Advertise the static input source list to the SmartThings app.
  -- Each entry requires both 'id' and 'name'; the array is wrapped in {value=...}
  -- because SmartThings capability events use that envelope format.
  local supported = {}
  for i, src in ipairs(INPUT_SOURCES) do
    supported[i] = src.id
  end
  device:emit_event(
    capabilities.mediaInputSource.supportedInputSources({ value = supported })
  )

  -- Supported key codes for input selection (NUMBER1‥5 → Analog1/2/Optical/Coaxial/Streaming)
  device:emit_event(
    capabilities.keypadInput.supportedKeyCodes({
      value = { "NUMBER1", "NUMBER2", "NUMBER3", "NUMBER4", "NUMBER5", "UP", "DOWN", "LEFT", "RIGHT", "SELECT", "HOME"},
    })
  )
end

--------------------------------------------------------------------------------
-- Lifecycle: init
--------------------------------------------------------------------------------
local function device_init(driver, device)
  local power_ep, mute_ep, volume_ep, keypad_ep, select_ep = discover_endpoints(device)

  device:set_field(POWER_EP,  power_ep)
  device:set_field(MUTE_EP,   mute_ep)
  device:set_field(VOLUME_EP, volume_ep)
  device:set_field(KEYPAD_EP, keypad_ep)
  device:set_field(SELECT_EP, select_ep)

  device.log.info(string.format(
    "[elac-amp] EP map → Power:%s  Mute:%s  Volume:%s  Keypad:%s  Select:%s",
    tostring(power_ep), tostring(mute_ep),
    tostring(volume_ep), tostring(keypad_ep), tostring(select_ep)
  ))

  -- Instruct ST Matter SDK how to map Hub Capabilities to Matter Endpoints
  device:set_component_to_endpoint_fn(function(dev, component_id, capability)
    local cap = type(capability) == "table" and capability.ID or capability
    if cap == capabilities.switch.ID then
      return power_ep or dev.MATTER_DEFAULT_ENDPOINT
    elseif cap == capabilities.audioMute.ID then
      return mute_ep or power_ep or dev.MATTER_DEFAULT_ENDPOINT
    elseif cap == capabilities.audioVolume.ID then
      return volume_ep or dev.MATTER_DEFAULT_ENDPOINT
    elseif cap == capabilities.mediaInputSource.ID then
      return select_ep or dev.MATTER_DEFAULT_ENDPOINT
    elseif cap == capabilities.keypadInput.ID then
      return keypad_ep or dev.MATTER_DEFAULT_ENDPOINT
    end
    return dev.MATTER_DEFAULT_ENDPOINT
  end)

  device:set_endpoint_to_component_fn(function(dev, endpoint_id)
    return "main"
  end)

  -- Establish the Matter subscription
  device:subscribe()

  -- Explicitly read current values so the UI is populated immediately
  read_current_state(device)

  -- Configure on init
  -- configure_handler(driver, device)
end

--------------------------------------------------------------------------------
-- Matter → SmartThings  (attribute report handlers)
--------------------------------------------------------------------------------

-- OnOff cluster report
--   EP1 / EP4  (share PowerServer)  → main.switch
--   EP2 / EP3  (share MuteServer)   → main.audioMute
--
-- MuteServer semantics (ElacMatterServer.ts):
--   on()  = setMute(true)  → device IS muted   → report OnOff=true  → emit "muted"
--   off() = setMute(false) → device IS unmuted  → report OnOff=false → emit "unmuted"
local function on_off_attr_handler(driver, device, ib, response)
  local ep        = ib.endpoint_id
  local power_ep  = device:get_field(POWER_EP)
  local mute_ep   = device:get_field(MUTE_EP)
  local volume_ep = device:get_field(VOLUME_EP)
  local keypad_ep = device:get_field(KEYPAD_EP)
  local val       = ib.data.value   -- boolean

  if ep == power_ep or ep == keypad_ep then
    -- PowerServer: OnOff=true → power ON
    device:emit_event(val and capabilities.switch.switch.on()
                           or capabilities.switch.switch.off())

  elseif ep == mute_ep or ep == volume_ep then
    -- MuteServer: OnOff=true → audio IS muted
    device:emit_event(val and capabilities.audioMute.mute.muted()
                           or capabilities.audioMute.mute.unmuted())
  end
end

-- LevelControl.CurrentLevel report  (EP3, VolumeServer)
-- Matter 0‥254  →  SmartThings 0‥100 %
local function level_attr_handler(driver, device, ib, response)
  if ib.data.value ~= nil then
    local volume = math.floor((ib.data.value / 254.0 * 100) + 0.5)
    device:emit_event_for_endpoint(ib.endpoint_id, capabilities.audioVolume.volume(volume))
  end
end

-- ModeSelect.CurrentMode report  (EP5, InputSelectServer)
-- Matter index is mapped 1:1 to INPUT_SOURCES table
local function mode_select_attr_handler(driver, device, ib, response)
  device.log.info("[elac-amp] mode_select_attr_handler report")
  if ib.data.value ~= nil then
    local src = INPUT_SOURCES[ib.data.value]
    if src then
      -- Both 'id' and 'name' are required by the mediaInputSource capability schema.
      -- Without 'name', the SmartThings app displays an empty string.
      device:emit_event(
        capabilities.mediaInputSource.inputSource({ value = src.id })
      )
    else
      device.log.warn(string.format(
        "[elac-amp] Unknown ModeSelect index: %s (valid range 1-%d)",
        tostring(ib.data.value), #INPUT_SOURCES
      ))
    end
  end
end

--------------------------------------------------------------------------------
-- SmartThings → Matter  (capability command handlers)
--------------------------------------------------------------------------------

-- switch.on / switch.off  →  PowerServer on EP1
local function handle_on(driver, device, cmd)
  local ep = device:get_field(POWER_EP)
  device:send(clusters.OnOff.server.commands.On(device, ep))
end

local function handle_off(driver, device, cmd)
  local ep = device:get_field(POWER_EP)
  device:send(clusters.OnOff.server.commands.Off(device, ep))
end

-- audioMute.mute / unmute / setMute  →  MuteServer on EP2
-- MuteServer.on() = setMute(true), so OnOff.On = mute
local function handle_mute(driver, device, cmd)
  local ep = device:get_field(MUTE_EP)
  device:send(clusters.OnOff.server.commands.On(device, ep))
end

local function handle_unmute(driver, device, cmd)
  local ep = device:get_field(MUTE_EP)
  device:send(clusters.OnOff.server.commands.Off(device, ep))
end

local function handle_set_mute(driver, device, cmd)
  local ep  = device:get_field(MUTE_EP)
  local req = (cmd.args.state == "muted")
      and clusters.OnOff.server.commands.On(device, ep)
      or  clusters.OnOff.server.commands.Off(device, ep)
  device:send(req)
end

-- audioVolume.setVolume / volumeUp / volumeDown  →  VolumeServer on EP3
local function handle_set_volume(driver, device, cmd)
  local ep    = device:get_field(VOLUME_EP)
  local level = math.floor(cmd.args.volume / 100.0 * 254)
  device:send(clusters.LevelControl.server.commands.MoveToLevelWithOnOff(
    device, ep, level, cmd.args.rate or 0, 0, 0
  ))
end

local function handle_volume_up(driver, device, cmd)
  local current = device:get_latest_state(
    "main", capabilities.audioVolume.ID, capabilities.audioVolume.volume.NAME
  ) or 50
  cmd.args.volume = math.min(current + VOLUME_STEP, 100)
  handle_set_volume(driver, device, cmd)
end

local function handle_volume_down(driver, device, cmd)
  local current = device:get_latest_state(
    "main", capabilities.audioVolume.ID, capabilities.audioVolume.volume.NAME
  ) or 50
  cmd.args.volume = math.max(current - VOLUME_STEP, 0)
  handle_set_volume(driver, device, cmd)
end

-- mediaInputSource.setInputSource  →  ModeSelect.ChangeToMode on EP5
local function handle_set_inputsource(driver, device, cmd)
  local ep = device:get_field(SELECT_EP)
  if not ep then
    device.log.warn("[elac-amp] ModeSelect endpoint not discovered yet")
    return
  end

  -- cmd.args.inputSource may arrive as a plain string id OR as an InputSource
  -- object { mode = "..." } depending on the SmartThings SDK version.
  local input_id = cmd.args.mode

  local index = INPUT_ID_TO_INDEX[input_id]
  if index then
    device.log.debug(string.format(
      "[elac-amp] setInputSource '%s' → ModeSelect ChangeToMode %d on EP%s",
      tostring(input_id), index, tostring(ep)
    ))
    device:send(clusters.ModeSelect.server.commands.ChangeToMode(device, ep, index))
  else
    device.log.warn(string.format(
      "[elac-amp] Unknown inputSource id: %s", tostring(input_id)
    ))
  end
end

-- keypadInput.sendKey  →  KeypadServer.SendKey on EP4
-- NUMBER1‥NUMBER5 select input sources (matches KeypadServer switch in ElacMatterServer.ts)
local function handle_send_key(driver, device, cmd)
  local ep = device:get_field(KEYPAD_EP)
  if not ep then
    device.log.warn("[elac-amp] Keypad endpoint not discovered")
    return
  end

  local KeyCode = clusters.KeypadInput.types.CecKeyCode
  local KEY_MAP = {
    NUMBER1 = KeyCode.NUMBERS1,
    NUMBER2 = KeyCode.NUMBERS2,
    NUMBER3 = KeyCode.NUMBERS3,
    NUMBER4 = KeyCode.NUMBERS4,
    NUMBER5 = KeyCode.NUMBERS5,
    UP = KeyCode.VOLUME_UP,
    DOWN = KeyCode.VOLUME_DOWN,
    LEFT = KeyCode.LEFT,
    RIGHT = KeyCode.RIGHT,
    SELECT = KeyCode.MUTE,
    HOME = KeyCode.POWER,
  }

  local key = KEY_MAP[cmd.args.keyCode]
  if key then
    device:send(clusters.KeypadInput.server.commands.SendKey(device, ep, key))
  else
    device.log.warn(string.format("[elac-amp] Unsupported key code: %s", tostring(cmd.args.keyCode)))
  end
end

--------------------------------------------------------------------------------
-- Driver Template
--------------------------------------------------------------------------------
local matter_driver_template = {
  lifecycle_handlers = {
    init        = device_init,
    doConfigure = configure_handler,
  },

  -- Matter attribute report → handler
  matter_handlers = {
    attr = {
      [clusters.OnOff.ID] = {
        [clusters.OnOff.attributes.OnOff.ID]           = on_off_attr_handler,
      },
      [clusters.LevelControl.ID] = {
        [clusters.LevelControl.attributes.CurrentLevel.ID] = level_attr_handler,
      },
      [clusters.ModeSelect.ID] = {
        [clusters.ModeSelect.attributes.CurrentMode.ID] = mode_select_attr_handler,
      },
    },
  },

  -- Attributes subscribed per capability
  subscribed_attributes = {
    [capabilities.switch.ID] = {
      clusters.OnOff.attributes.OnOff,
    },
    [capabilities.audioMute.ID] = {
      clusters.OnOff.attributes.OnOff,
    },
    [capabilities.audioVolume.ID] = {
      clusters.LevelControl.attributes.CurrentLevel,
    },
    [capabilities.mediaInputSource.ID] = {
      clusters.ModeSelect.attributes.CurrentMode,
    },
  },

  -- SmartThings command → handler
  capability_handlers = {
    [capabilities.switch.ID] = {
      [capabilities.switch.commands.on.NAME]  = handle_on,
      [capabilities.switch.commands.off.NAME] = handle_off,
    },
    [capabilities.audioMute.ID] = {
      [capabilities.audioMute.commands.mute.NAME]    = handle_mute,
      [capabilities.audioMute.commands.unmute.NAME]  = handle_unmute,
      [capabilities.audioMute.commands.setMute.NAME] = handle_set_mute,
    },
    [capabilities.audioVolume.ID] = {
      [capabilities.audioVolume.commands.volumeUp.NAME]   = handle_volume_up,
      [capabilities.audioVolume.commands.volumeDown.NAME] = handle_volume_down,
      [capabilities.audioVolume.commands.setVolume.NAME]  = handle_set_volume,
    },
    [capabilities.mediaInputSource.ID] = {
      [capabilities.mediaInputSource.commands.setInputSource.NAME] = handle_set_inputsource,
    },
    [capabilities.keypadInput.ID] = {
      [capabilities.keypadInput.commands.sendKey.NAME] = handle_send_key,
    },
  },

  -- Capabilities the driver handles (matches elac-amp.yml)
  supported_capabilities = {
    capabilities.switch,
    capabilities.audioVolume,
    capabilities.audioMute,
    capabilities.mediaInputSource,
    capabilities.keypadInput,
  },
}

local elac_driver = MatterDriver("elac-amp", matter_driver_template)
elac_driver:run()
