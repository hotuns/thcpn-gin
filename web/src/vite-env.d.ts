/// <reference types="vite/client" />

declare module "ezuikit-js" {
  export interface EZUIKitPlayerOptions {
    id: string;
    accessToken: string;
    url: string;
    width: number;
    height: number;
    template?: string;
    quality?: number | string;
    handleError?: (error: unknown) => void;
  }

  export class EZUIKitPlayer {
    constructor(options: EZUIKitPlayerOptions);
    play?: () => Promise<void> | void;
    stop?: () => Promise<void> | void;
    destroy?: () => Promise<void> | void;
    resize?: (width: number, height: number) => Promise<void> | void;
  }
}
