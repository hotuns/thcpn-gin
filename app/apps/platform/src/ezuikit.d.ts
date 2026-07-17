declare module "ezuikit-js" {
  export class EZUIKitPlayer {
    constructor(options: Record<string, unknown>);
    stop(): Promise<unknown>;
  }
}
