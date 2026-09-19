// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { api } from '@thcpn/api';
import { DeviceChildren } from './devices-page';

it('lists indexed gateway nodes without requiring child devices and links to the selected node', async () => {
  const children = vi.spyOn(api.devices, 'children').mockResolvedValue({items: []});
  const nodes = vi.spyOn(api.devices, 'nodes').mockResolvedValue({items: [{key:'gateway:gw:node:3', name:'样地东侧 · 节点 3', custom_name:'样地东侧', can_rename:true, target:{kind:'gateway_node',gateway_device_id:'gw',node_index:3},streams:[]}]});
  const element = document.createElement('div');
  const root = createRoot(element);
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><DeviceChildren workspaceId="space" deviceId="gw" onData={()=>{}}/></MemoryRouter></QueryClientProvider>));
    await act(async () => { await new Promise(resolve=>setTimeout(resolve,30)); });
    expect(element.textContent).toContain('样地东侧 · 节点 3');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/devices/gw?tab=data&node=gateway%3Agw%3Anode%3A3');
    expect(children).not.toHaveBeenCalled();
    expect(nodes).toHaveBeenCalledWith('gw');
  } finally { await act(async()=>root.unmount());client.clear();vi.restoreAllMocks(); }
});
