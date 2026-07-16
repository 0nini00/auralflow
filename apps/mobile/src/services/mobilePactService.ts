import AsyncStorage from "@react-native-async-storage/async-storage";

export const MOBILE_PACT_ACCEPTED_KEY = "auralflow.mobile.pactAccepted";

export async function hasAcceptedMobilePact(): Promise<boolean> {
  return (await AsyncStorage.getItem(MOBILE_PACT_ACCEPTED_KEY)) === "true";
}

export async function acceptMobilePact(): Promise<void> {
  await AsyncStorage.setItem(MOBILE_PACT_ACCEPTED_KEY, "true");
}
