import { memo, useEffect, useRef } from 'react';
import {
  createImmersiveBackgroundRenderer,
  type ImmersiveBackgroundOptions,
  type ImmersiveBackgroundRenderer,
} from '@/services/immersiveBackgroundRenderer';

export const ImmersiveBackground = memo(function ImmersiveBackground({ playing, onError }: ImmersiveBackgroundOptions) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ImmersiveBackgroundRenderer | null>(null);
  const initialState = useRef({ playing });
  const errorHandler = useRef(onError);

  useEffect(() => { errorHandler.current = onError; }, [onError]);
  useEffect(() => {
    if (!canvas.current) return;
    const instance = createImmersiveBackgroundRenderer(canvas.current, {
      ...initialState.current,
      onError: (message) => {
        if (errorHandler.current) errorHandler.current(message);
        else if (message) console.error(`[ImmersiveBackground] ${message}`);
      },
    });
    renderer.current = instance;
    return () => {
      instance.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => { renderer.current?.update({ playing }); }, [playing]);

  return <canvas ref={canvas} className="af-immersive-dynamic-background" aria-hidden="true" />;
});
