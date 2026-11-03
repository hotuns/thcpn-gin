declare module "gifenc" {
  type Palette = number[][];
  type Encoder = {
    writeFrame: (index: Uint8Array, width: number, height: number, options: { palette: Palette; delay: number; repeat: number }) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function GIFEncoder(): Encoder;
  export function quantize(pixels: Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(pixels: Uint8ClampedArray, palette: Palette): Uint8Array;
}
