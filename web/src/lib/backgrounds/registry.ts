import type { Component } from 'svelte';
import RainyWindow from './scenes/RainyWindow.svelte';
import MorningCounter from './scenes/MorningCounter.svelte';
import NightLights from './scenes/NightLights.svelte';
import FireplaceNook from './scenes/FireplaceNook.svelte';
import RooftopDusk from './scenes/RooftopDusk.svelte';

export interface SceneInfo {
  id: string;
  name: string;
  component: Component<{ still?: boolean }>;
}

export const scenes: SceneInfo[] = [
  { id: 'rainy-window', name: 'Rainy window seat', component: RainyWindow },
  { id: 'morning-counter', name: 'Sunny morning counter', component: MorningCounter },
  { id: 'night-lights', name: 'Night café', component: NightLights },
  { id: 'fireplace-nook', name: 'Fireplace nook', component: FireplaceNook },
  { id: 'rooftop-dusk', name: 'Rooftop at dusk', component: RooftopDusk },
];

export function sceneById(id: string): SceneInfo {
  return scenes.find((s) => s.id === id) ?? scenes[0];
}
