<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scenes } from '../backgrounds/registry';
  import { sound } from './mixes.svelte';

  let { disabled = false, lockedNote }: { disabled?: boolean; lockedNote?: string } = $props();

  // In a room, non-hosts see the host's list: they can load and add mixes, never change them.
  let manageOff = $derived(disabled || sound.roomMixes !== null);

  onMount(() => {
    void sound.load();
  });

  let name = $state('');
  let saveError = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  let renameError = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let list: HTMLElement | undefined = $state();

  // Background picker: one open at a time, placed with fixed coordinates so it stays on screen.
  const PICKER_WIDTH = 280;
  const PICKER_GUTTER = 12;
  let pickerId = $state<string | null>(null);
  let pickerLeft = $state(PICKER_GUTTER);
  let pickerTop = $state(0);
  let pickerEl: HTMLElement | undefined = $state();
  let pickerMix = $derived(sound.saved.find((m) => m.id === pickerId));

  const pickerButton = (id: string) =>
    list?.querySelector<HTMLButtonElement>(`button[data-picker="${CSS.escape(id)}"]`);

  function placePicker() {
    if (!pickerId) return;
    const btn = pickerButton(pickerId);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(PICKER_WIDTH, window.innerWidth - 2 * PICKER_GUTTER);
    pickerLeft = Math.max(
      PICKER_GUTTER,
      Math.min(r.right - width, window.innerWidth - width - PICKER_GUTTER),
    );
    pickerTop = r.bottom + 6;
  }

  function togglePicker(id: string) {
    pickerId = pickerId === id ? null : id;
  }

  $effect(() => {
    if (manageOff || !pickerMix) pickerId = null;
  });

  $effect(() => {
    if (!pickerId) return;
    const id = pickerId;
    placePicker();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pickerEl?.contains(t) || pickerButton(id)?.contains(t)) return;
      pickerId = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      pickerId = null;
      void tick().then(() => pickerButton(id)?.focus());
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', placePicker);
    window.addEventListener('scroll', placePicker, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', placePicker);
      window.removeEventListener('scroll', placePicker, true);
    };
  });

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

  /** Save the typed name. An empty name keeps the old one. A clash keeps editing unless `revert`. */
  function commitRename(id: string, revert = false) {
    if (renamingId !== id) return;
    if (!renameText.trim()) return stopRename();
    const err = sound.renameSaved(id, renameText);
    if (!err || revert) stopRename();
    else renameError = err;
  }

  async function askDelete(id: string) {
    deletingId = id;
    await tick();
    list?.querySelector<HTMLButtonElement>('button.cancel-delete')?.focus();
  }

  async function cancelDelete(id: string) {
    deletingId = null;
    await tick();
    list?.querySelector<HTMLButtonElement>(`button[data-del="${CSS.escape(id)}"]`)?.focus();
  }

  function confirmDelete(id: string) {
    deletingId = null;
    sound.deleteSaved(id);
  }

  function onRenameKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      stopRename();
    }
  }
</script>

<section class="mixer" aria-label="Sounds">
  <div class="top">
    <label class="switch">
      <input
        type="checkbox"
        checked={sound.enabled}
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
        oninput={onMaster}
      />
    </label>
  </div>

  {#if disabled && lockedNote}
    <p class="note">{lockedNote}</p>
  {/if}

  <div class="group" bind:this={list}>
    <h3>Mixes</h3>
    <ul class="mixes">
      {#each sound.saved as m (m.id)}
        <li class:editing={renamingId === m.id}>
          {#if renamingId === m.id}
            <div class="rename-wrap">
              <div class="rename-box">
                <input
                  class="rename text"
                  type="text"
                  maxlength="30"
                  aria-label={`New name for ${m.name}`}
                  bind:value={renameText}
                  {disabled}
                  onkeydown={(e) => onRenameKey(e, m.id)}
                  onblur={() => commitRename(m.id, true)}
                />
                <!-- mousedown is cancelled so the input keeps focus: only the click saves. -->
                <button
                  type="button"
                  class="enter"
                  aria-label="Save name"
                  {disabled}
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => commitRename(m.id)}
                >
                  <span aria-hidden="true">&crarr;</span>
                </button>
              </div>
              {#if renameError}<p class="error" role="alert">{renameError}</p>{/if}
            </div>
          {:else if deletingId === m.id}
            <div class="confirm">
              <p class="ask">Delete {m.name}?</p>
              <button
                type="button"
                class="btn"
                disabled={manageOff}
                onclick={() => confirmDelete(m.id)}
              >
                Delete
              </button>
              <button type="button" class="btn cancel-delete" onclick={() => cancelDelete(m.id)}>
                Cancel
              </button>
            </div>
          {:else}
            <span class="chip">
              <button
                type="button"
                class="btn has-icons"
                aria-pressed={sound.activeSavedId === m.id}
                {disabled}
                onclick={() => sound.loadSaved(m.id)}
              >
                {m.name}
              </button>
              <button
                type="button"
                class="pic"
                class:linked={sound.linksFor(m.id).length > 0}
                data-picker={m.id}
                aria-label={`Backgrounds for ${m.name}`}
                aria-haspopup="true"
                aria-expanded={pickerId === m.id}
                disabled={manageOff}
                onclick={() => togglePicker(m.id)}
              >
                <svg
                  viewBox="0 0 9 8"
                  width="18"
                  height="16"
                  shape-rendering="crispEdges"
                  aria-hidden="true"
                >
                  <rect class="fillbg" x="1" y="1" width="7" height="6" />
                  <rect class="sun" x="5" y="2" width="2" height="2" />
                  <rect class="hill" x="3" y="4" width="1" height="1" />
                  <rect class="hill" x="2" y="5" width="3" height="1" />
                  <rect class="hill" x="1" y="6" width="5" height="1" />
                  <rect class="frame" x="0" y="0" width="9" height="1" />
                  <rect class="frame" x="0" y="7" width="9" height="1" />
                  <rect class="frame" x="0" y="0" width="1" height="8" />
                  <rect class="frame" x="8" y="0" width="1" height="8" />
                </svg>
              </button>
            </span>
            <button
              type="button"
              class="icon"
              aria-label={`Rename ${m.name}`}
              disabled={manageOff}
              onclick={() => startRename(m.id, m.name)}
            >
              <span class="pencil" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="icon del"
              aria-label={`Delete ${m.name}`}
              data-del={m.id}
              disabled={manageOff}
              onclick={() => askDelete(m.id)}
            >
              <span class="cross" aria-hidden="true"></span>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </div>

  {#if pickerMix}
    <div
      class="picker panel"
      bind:this={pickerEl}
      role="group"
      aria-label={`Backgrounds for ${pickerMix.name}`}
      style:left="{pickerLeft}px"
      style:top="{pickerTop}px"
    >
      <p class="picker-hint">Start this mix when the background changes to:</p>
      {#each scenes as sc (sc.id)}
        <label class="check">
          <input
            type="checkbox"
            checked={sound.links[sc.id] === pickerMix.id}
            {disabled}
            onchange={(e) => sound.setLink(sc.id, pickerMix.id, e.currentTarget.checked)}
          />
          <span class="box" aria-hidden="true"></span>
          <span>{sc.name}</span>
          {#if sound.links[sc.id] && sound.links[sc.id] !== pickerMix.id}
            <span class="taken">
              (now {sound.saved.find((m) => m.id === sound.links[sc.id])?.name})
            </span>
          {/if}
        </label>
      {/each}
    </div>
  {/if}

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

  .chip {
    position: relative;
    display: flex;
    min-width: 0;
  }

  .pic {
    position: absolute;
    top: -9px;
    right: -9px;
    width: 24px;
    height: 24px;
    padding: 0;
    display: grid;
    place-items: center;
    background: none;
    border: 0;
    cursor: pointer;
  }

  .pic:focus-visible {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .pic:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .pic .frame,
  .pic .hill {
    fill: var(--ink);
  }

  .pic .sun {
    fill: var(--ink);
  }

  .pic .fillbg {
    fill: var(--white);
  }

  .pic.linked .fillbg {
    fill: var(--butter);
  }

  .pic.linked .sun {
    fill: var(--berry);
  }

  .pic.linked .hill {
    fill: var(--moss);
  }

  .picker {
    position: fixed;
    z-index: 20;
    width: min(280px, calc(100vw - 24px));
    padding: var(--s2);
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    color: var(--ink);
  }

  .picker-hint {
    margin: 0;
  }

  .check {
    position: relative;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s1) var(--s2);
    min-height: 36px;
    cursor: pointer;
  }

  .check input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .check .box {
    flex: none;
    box-sizing: border-box;
    width: 21px;
    height: 21px;
    background: var(--white);
    border: var(--border);
  }

  .check input:checked + .box {
    background: var(--matcha);
    box-shadow: inset 0 0 0 var(--px) var(--white);
  }

  .check input:focus-visible + .box {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .check input:disabled + .box {
    border-color: var(--plum);
    background: var(--foam);
  }

  .taken {
    color: var(--plum);
  }

  .rename-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    min-width: 0;
  }

  .rename-box {
    position: relative;
    display: flex;
  }

  .rename-box .text {
    padding-right: 44px;
  }

  .enter {
    position: absolute;
    top: 3px;
    right: 3px;
    bottom: 3px;
    width: 36px;
    padding: 0;
    display: grid;
    place-items: center;
    background: var(--butter);
    border: var(--border);
    color: var(--ink);
    cursor: pointer;
  }

  .enter:disabled {
    background: var(--foam);
    color: var(--plum);
    cursor: not-allowed;
  }

  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s1) var(--s2);
  }

  .ask {
    margin: 0;
    overflow-wrap: anywhere;
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
