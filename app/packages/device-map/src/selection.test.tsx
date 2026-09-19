// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const camera = vi.hoisted(()=>({fitBounds:vi.fn(),easeTo:vi.fn()}));
vi.mock('maplibre-gl',()=>({
 Map:class { addControl(){} on(){} off(){} remove(){} resize(){} fitBounds=camera.fitBounds;easeTo=camera.easeTo;getBounds(){return {getWest:()=>-180,getSouth:()=>-85,getEast:()=>180,getNorth:()=>85};}getZoom(){return 10;} },
 NavigationControl:class {},
 LngLatBounds:class {extend(){return this;}getCenter(){return [0,0];}},
 Marker:class {setLngLat(){return this;}addTo(){return this;}remove(){}},
}));
import { DeviceMap, type DeviceMapPoint } from './index';
it('centers selection without fitting all points or changing zoom',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const element=document.createElement('div');const root=createRoot(element);
 const points:DeviceMapPoint[]=[{device_id:'a',name:'A',device_type:'gateway',status:'active',longitude:110,latitude:30},{device_id:'b',name:'B',device_type:'gateway',status:'active',longitude:120,latitude:40}];
 try {
  await act(async()=>root.render(<DeviceMap points={points}/>));camera.fitBounds.mockClear();camera.easeTo.mockClear();
  await act(async()=>root.render(<DeviceMap points={[...points]} selectedDeviceId="b"/>));
  expect(camera.fitBounds).not.toHaveBeenCalled();expect(camera.easeTo).toHaveBeenCalledWith({center:[120,40]});
  camera.easeTo.mockClear();
  await act(async()=>root.render(<DeviceMap points={[...points]} selectedDeviceId="b"/>));
  expect(camera.easeTo).not.toHaveBeenCalled();expect(camera.fitBounds).not.toHaveBeenCalled();
  await act(async()=>root.render(<DeviceMap points={[...points]}/>));
  expect(camera.fitBounds).not.toHaveBeenCalled();
 } finally {await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
