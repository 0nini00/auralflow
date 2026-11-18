import { useSettingsStore, type AppSettings } from "../../src/stores/settingsStore";

/** 把 settingsStore 置为「已加载」。只需给出被测代码会读到的字段。 */
export function seedSettings(settings: Partial<AppSettings> = {}): void {
  useSettingsStore.setState({ settings: settings as AppSettings, loadError: null });
}
