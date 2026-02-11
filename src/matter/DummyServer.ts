import { MediaPlaybackServer } from "@matter/main/behaviors"
import { MediaPlayback } from "@matter/main/clusters"

const { PlaybackState, Status: MediaStatus } = MediaPlayback

export class DummyMediaPlaybackServer extends MediaPlaybackServer {
  override initialize() {
    this.state.currentState = PlaybackState.NotPlaying
  }

  override play() {
    this.state.currentState = PlaybackState.Playing
    return {
      status: MediaStatus.Success,
    }
  }

  override pause() {
    this.state.currentState = PlaybackState.Paused
    return {
      status: MediaStatus.Success,
    }
  }

  override stop() {
    this.state.currentState = PlaybackState.NotPlaying
    return {
      status: MediaStatus.Success,
    }
  }
}
