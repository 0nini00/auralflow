import React from "react";

import { BackgroundPlaybackSettings } from "@/components/settings/BackgroundPlaybackSettings";
import { ExternalPlaybackSettings } from "@/components/settings/ExternalPlaybackSettings";
import { PlaybackErrorSettings } from "@/components/settings/PlaybackErrorSettings";
import { PlaybackQualitySettings } from "@/components/settings/PlaybackQualitySettings";
import { ScrobbleSettings } from "@/components/settings/ScrobbleSettings";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function PlaybackSettingsScreen() {
  return (
    <SettingsPage title="播放" description="默认音质和播放行为">
      <PlaybackQualitySettings />
      <ExternalPlaybackSettings />
      <BackgroundPlaybackSettings />
      <PlaybackErrorSettings />
      <ScrobbleSettings />
    </SettingsPage>
  );
}
