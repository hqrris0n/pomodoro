<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { sound } from './mixes.svelte';

  let { disabled = false, lockedNote }: { disabled?: boolean; lockedNote?: string } = $props();

  onMount(() => {
    void sound.load();
  });

  let name = $state('');
  let saveError = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  let renameError = $state<string | null>(null);
  let list: HTMLElement | undefined = $state();

  let empty = $derived(!sound.channels.some((c) => (sound.mix[c.id] ?? 0) > 0));

  const isOn = (id: string) => (sound.mix[id] ?? 0) > 0;
  // An off channel shows the level it would come back on at.
  const pct = (id: string) => Math.round((sound.mix[id] ?? sound.levels[id] ?? 0.5) * 100);
  // Fill ends under the thumb centre: the thumb travels (100% - 18px).
  const fill = (v: number) => `calc(9px + (100% - 18px) * ${v / 100})`;
  const valueText = (v: number) => (v === 0 ? 'Off' : `${v}%`);

  function onVolume(id: string, e: Event) {
    sound.setVolume(id, Number((e.currentTarget as HTMLInputElement).value) / 100);
  }

  function onMaster(e: Event) {
    sound.setMaster(Number((e.currentTarget as HTMLInputElement).value) / 100);
  }

  function save() {
    const err = sound.saveCurrent(name);
    saveError = err;
    if (!err) name = '';
  }

  function onSaveKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  async function startRename(id: string, current: string) {
    renamingId = id;
    renameText = current;
    renameError = null;
    await tick();
    list?.querySelector<HTMLInputElement>('input.rename')?.focus();
  }

  function stopRename() {
    renamingId = null;
    renameError = null;
  }

  function onRenameKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const err = sound.renameSaved(id, renameText);
      if (err) renameError = err;
      else stopRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      stopRename();
    }
  }
</script>

<section class="mixer" aria-label="Sounds">
  {#if disabled && lockedNote}
    <p class="note">{lockedNote}</p>
  {/if}

  <div class="top">
    <label class="switch">
      <input
        type="checkbox"
        checked={sound.enabled}
        {disabled}
        onchange={(e) => sound.setEnabled(e.currentTarget.checked)}
      />
      <span class="track" aria-hidden="true"><span class="knob"></span></span>
      <span>Sound</span>
    </label>
    <label class="master">
      <span>Overall volume</span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={Math.round(sound.master * 100)}
        style:--fill={fill(Math.round(sound.master * 100))}
        aria-valuetext={`${Math.round(sound.master * 100)}%`}
        {disabled}
        oninput={onMaster}
      />
    </label>
  </div>

  <div class="group" bind:this={list}>
    <h3>Mixes</h3>
    <ul class="mixes">
      {#each sound.saved as m (m.id)}
        <li class:editing={renamingId === m.id}>
          {#if renamingId === m.id}
            <div class="rename-wrap">
              <input
                class="rename text"
                type="text"
                maxlength="30"
                aria-label={`New name for ${m.name}`}
                bind:value={renameText}
                {disabled}
                onkeydown={(e) => onRenameKey(e, m.id)}
              />
              {#if renameError}<p class="error" role="alert">{renameError}</p>{/if}
            </div>
          {:else}
            <button
              type="button"
              class="btn"
              class:has-icons={!m.builtIn}
              aria-pressed={sound.activeSavedId === m.id}
              {disabled}
              onclick={() => sound.loadSaved(m.id)}
            >
              {m.name}
            </button>
            {#if !m.builtIn}
              <button
                type="button"
                class="icon"
                aria-label={`Rename ${m.name}`}
                {disabled}
                onclick={() => startRename(m.id, m.name)}
              >
                <span class="pencil" aria-hidden="true"></span>
              </button>
              <button
                type="button"
                class="icon del"
                aria-label={`Delete ${m.name}`}
                {disabled}
                onclick={() => sound.deleteSaved(m.id)}
              >
                <span class="cross" aria-hidden="true"></span>
              </button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </div>

  <div class="group">
    <h3>Sounds</h3>
    {#if sound.error}
      <p class="error" role="alert">{sound.error}</p>
    {:else}
      <ul class="channels">
        {#each sound.channels as c (c.id)}
          {@const v = pct(c.id)}
          {@const on = isOn(c.id)}
          <li class:off={!on}>
            <label class="switch small">
              <input
                type="checkbox"
                checked={on}
                aria-label={`Play ${c.name}`}
                {disabled}
                onchange={(e) => sound.setChannelOn(c.id, e.currentTarget.checked)}
              />
              <span class="track" aria-hidden="true"><span class="knob"></span></span>
            </label>
            <label class="vol">
              <span class="cname">{c.name}</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={v}
                style:--fill={fill(v)}
                aria-label={c.name}
                aria-valuetext={valueText(on ? v : 0)}
                disabled={disabled || !on}
                oninput={(e) => onVolume(c.id, e)}
              />
            </label>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="group">
    <h3>Save this mix</h3>
    <div class="save">
      <input
        class="text"
        type="text"
        placeholder="Name this mix"
        aria-label="Mix name"
        maxlength="30"
        bind:value={name}
        oninput={() => (saveError = null)}
        onkeydown={onSaveKey}
        {disabled}
      />
      <button type="button" class="btn" disabled={disabled || empty} onclick={save}>Save</button>
    </div>
    {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
  </div>
</section>

<style>
  .mixer {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    color: var(--ink);
  }

  .note {
    margin: 0;
    padding: var(--s1) var(--s2);
    background: var(--white);
    border: var(--border);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  h3 {
    font-size: var(--t2);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .error {
    margin: 0;
    color: var(--berry);
  }

  /* top row: switch + master */
  .top {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }

  .switch {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s1);
    min-height: 42px;
    cursor: pointer;
  }

  .switch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .switch .track {
    flex: none;
    position: relative;
    width: 54px;
    height: 30px;
    background: var(--white);
    border: var(--border);
  }

  .switch .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    background: var(--ink);
  }

  .switch input:checked + .track {
    background: var(--matcha);
  }

  .switch input:checked + .track .knob {
    left: auto;
    right: 3px;
  }

  .switch input:focus-visible + .track {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .switch input:disabled ~ * {
    color: var(--plum);
  }

  .switch input:disabled + .track {
    background: var(--foam);
    border-color: var(--plum);
  }

  .switch input:disabled + .track .knob {
    background: var(--plum);
  }

  .master {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* mixes */
  .mixes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1) var(--s2);
  }

  .mixes li {
    display: flex;
    align-items: center;
    max-width: 100%;
  }

  .mixes li.editing {
    flex: 1 1 100%;
  }

  .mixes .btn {
    min-width: 0;
    padding-inline: var(--s2);
    overflow-wrap: anywhere;
  }

  .rename-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    min-width: 0;
  }

  .icon {
    flex: none;
    width: 36px;
    height: 42px;
    padding: 0;
    display: grid;
    place-items: center;
    background: none;
    border: 0;
    cursor: pointer;
  }

  .icon:disabled {
    cursor: not-allowed;
  }

  .icon:disabled span {
    background: var(--plum);
    opacity: 0.5;
  }

  .icon:hover:not(:disabled) .pencil {
    background: var(--ink);
    box-shadow: var(--pencil-shadow);
  }

  .del:hover:not(:disabled) .cross {
    background: var(--berry);
  }

  /* a pencil: one art pixel, stepped diagonally with hard shadows */
  .pencil {
    --pencil-shadow:
      calc(var(--px) * -1) 0 0 var(--plum), calc(var(--px) * -1) var(--px) 0 var(--plum),
      calc(var(--px) * -2) var(--px) 0 var(--plum),
      calc(var(--px) * -2) calc(var(--px) * 2) 0 var(--plum),
      calc(var(--px) * -3) calc(var(--px) * 2) 0 var(--plum),
      calc(var(--px) * -3) calc(var(--px) * 3) 0 var(--plum),
      calc(var(--px) * -4) calc(var(--px) * 3) 0 var(--plum),
      calc(var(--px) * -4) calc(var(--px) * 4) 0 var(--plum);
    display: block;
    width: var(--px);
    height: var(--px);
    margin-left: calc(var(--px) * 4);
    margin-bottom: calc(var(--px) * 4);
    background: var(--plum);
    box-shadow: var(--pencil-shadow);
  }

  .cross {
    display: block;
    width: 15px;
    height: 15px;
    background: var(--plum);
    clip-path: polygon(
      0 0,
      var(--px) 0,
      50% calc(50% - var(--px)),
      calc(100% - var(--px)) 0,
      100% 0,
      100% var(--px),
      calc(50% + var(--px)) 50%,
      100% calc(100% - var(--px)),
      100% 100%,
      calc(100% - var(--px)) 100%,
      50% calc(50% + var(--px)),
      var(--px) 100%,
      0 100%,
      0 calc(100% - var(--px)),
      calc(50% - var(--px)) 50%,
      0 var(--px)
    );
  }

  /* channels */
  .channels {
    display: flex;
    flex-direction: column;
  }

  .channels li {
    border-bottom: 1px dashed var(--plum);
  }

  .channels li {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .switch.small .track {
    width: 36px;
    height: 22px;
  }

  .switch.small .knob {
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
  }

  .switch.small input:checked + .track .knob {
    right: 2px;
  }

  .channels label.vol {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 104px 1fr;
    align-items: center;
    gap: var(--s2);
    min-height: 42px;
  }

  .cname {
    overflow-wrap: anywhere;
    line-height: 1.1;
  }

  .channels li.off .cname {
    color: var(--plum);
  }

  /* text inputs */
  .text {
    flex: 1;
    min-width: 0;
    min-height: 42px;
    padding: var(--s1) 4px;
    background: var(--white);
    border: var(--border);
    border-radius: 0;
  }

  .text::placeholder {
    color: var(--plum);
  }

  .text:disabled {
    background: var(--foam);
    color: var(--plum);
  }

  .save {
    display: flex;
    gap: var(--s1);
  }

  /* pixel range slider */
  input[type='range'] {
    --fill: 9px;
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    min-width: 0;
    height: 42px;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  input[type='range']:disabled {
    cursor: not-allowed;
  }

  input[type='range']::-webkit-slider-runnable-track {
    box-sizing: content-box;
    height: 6px;
    border: var(--border);
    border-radius: 0;
    background: linear-gradient(to right, var(--matcha) var(--fill), var(--white) var(--fill));
  }

  input[type='range']::-moz-range-track {
    box-sizing: content-box;
    height: 6px;
    border: var(--border);
    border-radius: 0;
    background: linear-gradient(to right, var(--matcha) var(--fill), var(--white) var(--fill));
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    margin-top: -9px;
    background: var(--butter);
    border: var(--border);
    border-radius: 0;
    box-shadow: var(--shadow);
  }

  input[type='range']::-moz-range-thumb {
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    background: var(--butter);
    border: var(--border);
    border-radius: 0;
    box-shadow: var(--shadow);
  }

  input[type='range']:active::-webkit-slider-thumb {
    background: var(--strawberry);
  }

  input[type='range']:active::-moz-range-thumb {
    background: var(--strawberry);
  }

  input[type='range']:disabled::-webkit-slider-runnable-track {
    background: linear-gradient(to right, var(--plum) var(--fill), var(--foam) var(--fill));
  }

  input[type='range']:disabled::-moz-range-track {
    background: linear-gradient(to right, var(--plum) var(--fill), var(--foam) var(--fill));
  }

  input[type='range']:disabled::-webkit-slider-thumb {
    background: var(--foam);
    border-color: var(--plum);
    box-shadow: none;
  }

  input[type='range']:disabled::-moz-range-thumb {
    background: var(--foam);
    border-color: var(--plum);
    box-shadow: none;
  }

  input[type='range']:focus-visible {
    outline: none;
  }

  input[type='range']:focus-visible::-webkit-slider-thumb {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  input[type='range']:focus-visible::-moz-range-thumb {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }
</style>
