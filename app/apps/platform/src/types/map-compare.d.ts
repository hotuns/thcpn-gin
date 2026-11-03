declare module "@maplibre/maplibre-gl-compare" {
  import type { Map } from "maplibre-gl";
  export default class Compare {
    constructor(before: Map, after: Map, container: HTMLElement, options?: { orientation?: "vertical" | "horizontal"; mousemove?: boolean });
    setSlider(position: number): void;
    on(event: "slideend", callback: (event: { currentPosition: number }) => void): this;
    remove(): void;
  }
}
