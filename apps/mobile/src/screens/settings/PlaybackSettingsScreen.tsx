import React from "react";

import { SoundEffectPanel } from "@/components/SoundEffectPanel";
import { ExternalPlaybackSettings } from "@/components/settings/ExternalPlaybackSettings";
import { PlaybackQualitySettings } from "@/components/settings/PlaybackQualitySettings";
import { SettingsPage } from "@/components/settings/SettingsPage";

export function PlaybackSettingsScreen() {
  return (
    <SettingsPage title="播放与音效" description="播放音质、音频打断和音效">
      <PlaybackQualitySettings />
      <ExternalPlaybackSettings />
      <SoundEffectPanel />
    </SettingsPage>
  );
}
