import { useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";
import { resolveMobileLink } from "@/services/externalFileService";
import { createMobileLinkController } from "@/services/mobileLinkController";

export type ResolvedMobileIntent = NonNullable<Awaited<ReturnType<typeof resolveMobileLink>>>;

export function useMobileDeepLinks(
  ready: boolean,
  dispatch: (intent: ResolvedMobileIntent, isCurrent: () => boolean) => void | Promise<void>,
) {
  const controller = useRef<ReturnType<typeof createMobileLinkController<ResolvedMobileIntent>> | null>(null);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const onError = (error: unknown) => {
      if (active) Alert.alert("打开失败", error instanceof Error ? error.message : String(error));
    };
    const current = createMobileLinkController({ resolve: resolveMobileLink, dispatch, onError });
    controller.current = current;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      receivedEvent = true;
      void current.receive(url);
    });
    void Linking.getInitialURL().then((url) => {
      if (!receivedEvent) return current.receive(url);
    }).catch(onError);
    return () => {
      active = false;
      subscription.remove();
      current.dispose();
      controller.current = null;
    };
  }, [dispatch]);

  useEffect(() => {
    void controller.current?.setReady(ready);
  }, [ready, dispatch]);
}
