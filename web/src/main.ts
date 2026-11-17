import { mount, type Component } from 'svelte';
import './styles/global.css';
import App from './App.svelte';

const target = document.getElementById('app')!;

// Dev only: /#demo/<Name> mounts <Name>.demo.svelte (under src/lib or src/screens) on its own,
// so a component can be looked at (and screenshotted) in isolation.
async function demoComponent(): Promise<Component | null> {
  if (!import.meta.env.DEV || !location.hash.startsWith('#demo/')) return null;
  const name = location.hash.slice('#demo/'.length);
  const demos = import.meta.glob<{ default: Component }>([
    './lib/**/*.demo.svelte',
    './screens/**/*.demo.svelte',
  ]);
  const path = Object.keys(demos).find((p) => p.endsWith(`/${name}.demo.svelte`));
  return path ? (await demos[path]()).default : null;
}

demoComponent().then((Demo) => mount(Demo ?? App, { target }));
