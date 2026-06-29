export interface UserDataResetActions {
  resetPersistentData: () => Promise<void>;
  clearFavorites: () => void;
  clearPlaylists: () => void;
  clearLibrary: () => void;
  clearCustomSources: () => void;
  clearHistory: () => void;
  resetSoundEffects: () => void;
}

export async function resetUserDataWithActions(actions: UserDataResetActions): Promise<void> {
  await actions.resetPersistentData();
  actions.clearFavorites();
  actions.clearPlaylists();
  actions.clearLibrary();
  actions.clearCustomSources();
  actions.clearHistory();
  actions.resetSoundEffects();
}
