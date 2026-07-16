declare module "soundtouchjs" {
  export class SoundTouch {
    constructor();
    clear(): void;
    clone(): SoundTouch;
    get rate(): number;
    set rate(value: number);
    get rateChange(): number;
    set rateChange(value: number);
    get tempo(): number;
    set tempo(value: number);
    get tempoChange(): number;
    set tempoChange(value: number);
    get pitch(): number;
    set pitch(value: number);
    get pitchOctaves(): number;
    set pitchOctaves(value: number);
    get pitchSemitones(): number;
    set pitchSemitones(value: number);
    inputBuffer: unknown;
    outputBuffer: unknown;
    calculateEffectiveRateAndTempo(rate: number): void;
    process(): void;
  }

  export interface SampleSource {
    extract(target: Float32Array, numFrames: number, position?: number): number;
    position: number;
  }

  export class SimpleFilter {
    constructor(sourceSound: SampleSource, pipe: SoundTouch, callback?: () => void);
    extract(target: Float32Array, numFrames: number): number;
    get sourcePosition(): number;
    set sourcePosition(value: number);
    clear(): void;
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    extract(target: Float32Array, numFrames?: number, position?: number): number;
    position: number;
  }

  export function getWebAudioNode(
    context: AudioContext,
    filter: SimpleFilter,
    callback?: (pos: number) => void,
    bufferSize?: number,
  ): ScriptProcessorNode;
}
